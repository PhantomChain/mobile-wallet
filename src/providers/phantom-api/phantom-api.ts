import { Injectable } from '@angular/core';

import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/expand';

import { UserDataProvider } from '@providers/user-data/user-data';
import { StorageProvider } from '@providers/storage/storage';
import { ToastProvider } from '@providers/toast/toast';

import { Transaction, TranslatableObject } from '@models/model';

import * as phantomts from 'phantom-ts';
import lodash from 'lodash';
import * as constants from '@app/app.constants';
import phantomtsConfig from 'phantom-ts/config';
import { PhantomUtility } from '../../utils/phantom-utility';
import { Delegate } from 'phantom-ts';
import { StoredNetwork } from '@models/stored-network';

@Injectable()
export class PhantomApiProvider {

  public onUpdatePeer$: Subject<phantomts.Peer> = new Subject<phantomts.Peer>();
  public onUpdateDelegates$: Subject<phantomts.Delegate[]> = new Subject<phantomts.Delegate[]>();
  public onSendTransaction$: Subject<phantomts.Transaction> = new Subject<phantomts.Transaction>();

  private _network: StoredNetwork;
  private _api: phantomts.Client;

  private _fees: phantomts.Fees;
  private _delegates: phantomts.Delegate[];

  public phantomjscore = require('phantomjscore');

  constructor(
    private userDataProvider: UserDataProvider,
    private storageProvider: StorageProvider,
    private toastProvider: ToastProvider) {
    this.loadData();

    this.userDataProvider.onActivateNetwork$.subscribe((network) => {

      if (lodash.isEmpty(network)) { return; }

      this.setNetwork(network);
    });
  }

  public get network() {
    return this._network;
  }

  public get api() {
    return this._api;
  }

  public get fees() {
    if (!lodash.isUndefined(this._fees)) { return Observable.of(this._fees); }

    return this.fetchFees();
  }

  public get delegates(): Observable<phantomts.Delegate[]> {
    if (!lodash.isEmpty(this._delegates)) { return Observable.of(this._delegates); }

    return this.fetchDelegates(constants.NUM_ACTIVE_DELEGATES * 2);
  }

  public setNetwork(network: StoredNetwork) {
    // set default peer
    if (network.type !== null) {
      const activePeer = network.activePeer;
      const apiNetwork = phantomts.Network.getDefault(network.type);
      if (apiNetwork) {
        network = Object.assign<StoredNetwork, phantomts.Network>(network, apiNetwork);
      }
      if (activePeer) {
        network.activePeer = activePeer;
      }
    }

    this._network = network;
    this.phantomjscore.crypto.setNetworkVersion(this._network.version);

    this._api = new phantomts.Client(this._network);
    this.findGoodPeer();
  }

  public async findGoodPeer() {
    // Get list from active peer
    this._api.peer.list().subscribe(async (response) => {
      if (response && await this.findGoodPeerFromList(response.peers)) {
        return;
      } else {
        await this.tryGetFallbackPeer();
      }
    },
    async () => await this.tryGetFallbackPeer());
  }

  private async tryGetFallbackPeer() {
    if (await this.findGoodPeerFromList(this.network.peerList)) {
      return;
    }

    // try get a peer from the hardcoded phantom-ts peerlist (only works for main and devnet)
    phantomts.PeerApi
      .findGoodPeer(this._network)
      .subscribe((peer) => this.updateNetwork(peer),
        () => this.toastProvider.error('API.PEER_LIST_ERROR'));
  }

  private async findGoodPeerFromList(peerList: phantomts.Peer[]) {
    if (!peerList || !peerList.length) {
      return false;
    }
    const port = +(this._network.p2pPort || this._network.activePeer.port);
    // Force P2P port if specified in the network
    if (this._network.p2pPort) {
      for (const peer of peerList) {
        peer.port = +this._network.p2pPort;
      }
    }
    const preFilteredPeers = lodash.filter(peerList, (peer) => {
      if (peer['status'] !== 'OK') {
        return false;
      }

      if (peer['port'] !== port) {
        return false;
      }

      if (peer.ip === this._network.activePeer.ip || peer.ip === '127.0.0.1') {
        return false;
      }

      return true;
    });

    let filteredPeers = [];
    if (!this._network.isV2) {
      filteredPeers = preFilteredPeers;
    } else {
      const configChecks = [];
      for (const peer of preFilteredPeers) {
        configChecks.push(this._api.peer.getVersion2Config(peer.ip, peer.port).toPromise());
      }

      const peerConfigResponses = await Promise.all(configChecks.map(p => p.catch(e => e)));
      for (const peerId in peerConfigResponses) {
        const config = peerConfigResponses[peerId];
        const apiConfig = lodash.get(config, 'data.plugins["@phantomecosystem/core-api"]');
        if (apiConfig && apiConfig.enabled && apiConfig.port) {
          const peer = preFilteredPeers[peerId];
          peer.port = apiConfig.port;
          filteredPeers.push(peer);
        }
      }
    }

    const missingHeights = [];
    const missingHeightRequests = [];
    for (const peerId in filteredPeers) {
      const peer = filteredPeers[peerId];
      if (!peer.height) {
        missingHeights.push({
          id: peerId,
          peer
        });
        missingHeightRequests.push(this._api.loader.synchronisationStatus(`http://${peer.ip}:${peer.port}`).toPromise());
      }
    }

    if (missingHeightRequests.length) {
      const missingHeightResponses = await Promise.all(missingHeightRequests.map(p => p.catch(e => e)));
      for (const peerId in missingHeightResponses) {
        const response = missingHeightResponses[peerId];
        if (response && response.height) {
          const missingHeight = missingHeights[peerId];
          const peer = missingHeight.peer;
          peer.height = response.height;
          filteredPeers[missingHeight.peerId] = peer;
        }
      }
    }

    const sortedPeers = lodash.orderBy(filteredPeers, ['height', 'delay'], ['desc', 'asc']);
    if (!sortedPeers.length) {
      return false;
    }
    this._network.peerList = sortedPeers;
    this.updateNetwork(sortedPeers[0]);
    return true;
  }

  public fetchDelegates(numberDelegatesToGet: number, getAllDelegates = false): Observable<phantomts.Delegate[]> {
    if (!this._api) { return; }
    const limit = 51;

    const totalCount = limit;
    let offset, currentPage;
    offset = currentPage = 0;

    let totalPages = totalCount / limit;

    let delegates: phantomts.Delegate[] = [];

    return Observable.create((observer) => {

      this._api.delegate.list({ limit, offset }).expand(() => {
        const req = this._api.delegate.list({ limit, offset });
        return currentPage < totalPages ? req : Observable.empty();
      }).do((response) => {
        offset += limit;
        if (response.success && getAllDelegates) { numberDelegatesToGet = response.totalCount; }
        totalPages = Math.ceil(numberDelegatesToGet / limit);
        currentPage++;
      }).finally(() => {
        this.storageProvider.set(constants.STORAGE_DELEGATES, delegates);
        this.onUpdateDelegates$.next(delegates);

        observer.next(delegates);
        observer.complete();
      }).subscribe((data) => {
        if (data.success) { delegates = [...delegates, ...data.delegates]; }
      });
    });

  }

  public createTransaction(transaction: Transaction, key: string, secondKey: string, secondPassphrase: string): Observable<Transaction> {
    return Observable.create((observer) => {
      const configNetwork = phantomtsConfig.networks[this._network.name];
      let jsNetwork;
      if (configNetwork) {
        jsNetwork = {
          messagePrefix: configNetwork.name,
          bip32: configNetwork.bip32,
          pubKeyHash: configNetwork.version,
          wif: configNetwork.wif,
        };
      }

      if (!phantomts.PublicKey.validateAddress(transaction.address, this._network)) {
        observer.error({
          key: 'API.DESTINATION_ADDRESS_ERROR',
          parameters: {address: transaction.address}
        } as TranslatableObject);
        return observer.complete();
      }

      const wallet = this.userDataProvider.getWalletByAddress(transaction.address);
      transaction.senderId = transaction.address;

      const totalAmount = transaction.getAmount();
      const balance = Number(wallet.balance);
      if (totalAmount > balance) {
        this.toastProvider.error('API.BALANCE_TOO_LOW');
        observer.error({
          key: 'API.BALANCE_TOO_LOW_DETAIL',
          parameters: {
            token: this._network.token,
            fee: PhantomUtility.phantomtoshiToPhantom(transaction.fee),
            amount: PhantomUtility.phantomtoshiToPhantom(transaction.amount),
            totalAmount: PhantomUtility.phantomtoshiToPhantom(totalAmount),
            balance: PhantomUtility.phantomtoshiToPhantom(balance)
          }
        } as TranslatableObject);
        return observer.complete();
      }

      transaction.signature = null;
      transaction.signSignature = null;
      transaction.id = null;

      const keys = this.phantomjscore.crypto.getKeys(key, jsNetwork);
      this.phantomjscore.crypto.sign(transaction, keys);

      secondPassphrase = secondKey || secondPassphrase;

      if (secondPassphrase) {
        const secondKeys = this.phantomjscore.crypto.getKeys(secondPassphrase, jsNetwork);
        this.phantomjscore.crypto.secondSign(transaction, secondKeys);
      }

      transaction.id = this.phantomjscore.crypto.getId(transaction);

      observer.next(transaction);
      observer.complete();
    });
  }

  public postTransaction(transaction: phantomts.Transaction, peer: phantomts.Peer = this._network.activePeer, broadcast: boolean = true) {
    return Observable.create((observer) => {
      this._api.transaction.post(transaction, peer).subscribe((result: phantomts.TransactionPostResponse) => {
        if (result.transactionIds && result.transactionIds.indexOf(transaction.id) !== -1) {
          this.onSendTransaction$.next(transaction);
          if (broadcast) {
            this.broadcastTransaction(transaction);
            this.toastProvider.success('API.TRANSACTION_SENT');
          }
          observer.next(transaction);
        } else {
          if (broadcast) {
            this.toastProvider.error('API.TRANSACTION_FAILED');
          }
          observer.error(result);
        }
      }, (error) => observer.error(error));
    });
  }

  public getDelegateByPublicKey(publicKey: string): Observable<Delegate> {
    if (!publicKey) {
      return Observable.of(null);
    }

    return this.api
               .delegate
               .get({publicKey: publicKey})
               .map(response => response && response.success ? response.delegate : null);
  }

  private broadcastTransaction(transaction: phantomts.Transaction) {
    if (!this._network.peerList || !this._network.peerList.length) {
      return;
    }

    for (const peer of this._network.peerList.slice(0, 10)) {
      this.postTransaction(transaction, peer, false).subscribe(
        null,
        null
      );
    }
  }

  private updateNetwork(peer?: phantomts.Peer): void {
    if (peer) {
      this._network.setPeer(peer);
      this.onUpdatePeer$.next(peer);
    }
    // Save in localStorage
    this.userDataProvider.addOrUpdateNetwork(this._network, this.userDataProvider.currentProfile.networkId);
    this._api = new phantomts.Client(this._network);

    this.fetchDelegates(constants.NUM_ACTIVE_DELEGATES * 2).subscribe((data) => {
      this._delegates = data;
    });

    this.fetchFees().subscribe();
  }

  private fetchFees(): Observable<phantomts.Fees> {
    return Observable.create((observer) => {
      phantomts.BlockApi.networkFees(this._network).subscribe((response) => {
        if (response && response.success) {
          this._fees = response.fees;
          this.storageProvider.set(constants.STORAGE_FEES, this._fees);

          observer.next(this._fees);
        }
      }, () => {
        observer.next(this.storageProvider.getObject(constants.STORAGE_FEES));
      });
    });
  }

  private loadData() {
    this.storageProvider.getObject(constants.STORAGE_DELEGATES).subscribe((delegates) => this._delegates = delegates);
  }

}
