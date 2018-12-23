import { Network, Peer } from '@phantomchain/phantom-ts';

export class StoredNetwork extends Network {
  public marketTickerName: string;
  public peerList: Peer[];
}
