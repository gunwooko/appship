import Purchases from 'react-native-purchases';

export function configurePurchases(apiKey: string): void {
  Purchases.configure({ apiKey });
}
