import { Component } from '@angular/core';
import { IonicPage, NavController, NavParams, ViewController } from 'ionic-angular';

import { PhantomApiProvider } from '@providers/phantom-api/phantom-api';

import bip39 from 'bip39';
import { Fees, Network } from '@phantomchain/phantom-ts';

@IonicPage()
@Component({
  selector: 'page-register-second-passphrase',
  templateUrl: 'register-second-passphrase.html',
})
export class RegisterSecondPassphrasePage {

  public passphrase: string;
  public repassphrase: string;
  public fees: Fees;
  public currentNetwork: Network;

  public step = 1;
  public isWrong = false;

  constructor(
    public navCtrl: NavController,
    public navParams: NavParams,
    private viewCtrl: ViewController,
    private phantomApiProvider: PhantomApiProvider,
  ) {
  }

  prev() {
    this.step -= 1;
  }

  next() {
    this.repassphrase = undefined;
    this.isWrong = false;
    this.step += 1;
  }

  create() {
    if (this.passphrase !== this.repassphrase) {
      this.isWrong = true;
      return;
    }

    this.dismiss(this.passphrase);
  }

  dismiss(result?: any) {
    this.viewCtrl.dismiss(result);
  }

  ionViewDidLoad() {
    this.passphrase = bip39.generateMnemonic();
    this.currentNetwork = this.phantomApiProvider.network;
    this.phantomApiProvider.fees.subscribe((fees) => this.fees = fees);
  }

}
