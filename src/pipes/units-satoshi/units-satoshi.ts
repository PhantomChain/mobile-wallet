import { Pipe, PipeTransform } from '@angular/core';
import { PhantomUtility } from '../../utils/phantom-utility';

@Pipe({
  name: 'unitsSatoshi',
})
export class UnitsSatoshiPipe implements PipeTransform {

  transform(value: number | string, returnRaw: boolean = false) {
    if (typeof value === 'string') { value = Number(value); }

    return PhantomUtility.phantomtoshiToPhantom(value, returnRaw);
  }
}
