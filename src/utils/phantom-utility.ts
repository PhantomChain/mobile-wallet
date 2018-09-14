import * as constants from '@app/app.constants';
import BigNumber from 'bignumber.js';

export class PhantomUtility {
  public static getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public static phantomtoshiToPhantom(phantom: number, returnRaw: boolean = false): number {
    let result: number = phantom / constants.WALLET_UNIT_TO_SATOSHI;

    if (!returnRaw) {
      result = Number((new BigNumber(result.toString())).toFixed(constants.PHANTOMTOSHI_DP));
    }

    return result;
  }
}
