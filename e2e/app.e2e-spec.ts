import { browser, element, by } from 'protractor';

describe('PhantomApp', () => {

  beforeEach(() => {
    browser.get('');
  });

  it('should have a title', () => {
    browser.getTitle().then(title => expect(title).toEqual('Phantom Mobile'));
  });
});
