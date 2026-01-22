import * as circle from '@circle-fin/developer-controlled-wallets';
console.log('Exports:', Object.keys(circle));
if (circle.Blockchain) {
    console.log('Blockchain enum keys:', Object.keys(circle.Blockchain));
}
