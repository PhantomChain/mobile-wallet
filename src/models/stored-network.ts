import { Network, Peer } from 'phantom-ts';

export class StoredNetwork extends Network {
  public marketTickerName: string;
  public peerList: Peer[];
}
