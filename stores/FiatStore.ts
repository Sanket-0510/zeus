import { action, observable } from 'mobx';
import RNFetchBlob from 'rn-fetch-blob';
import SettingsStore from './SettingsStore';

interface CurrencyDisplayRules {
    symbol: string;
    space: boolean;
    rtl: boolean;
}
export default class FiatStore {
    @observable public fiatRates: any = {};
    @observable public loading = false;
    @observable public error = false;

    getFiatRatesToken: any;

    settingsStore: SettingsStore;

    constructor(settingsStore: SettingsStore) {
        this.settingsStore = settingsStore;
    }

    // TODO integrate separatorSwap display
    private symbolLookup = (symbol: string): CurrencyDisplayRules => {
        const symbolPairs: any = {
            USD: { symbol: '$', space: false, rtl: false },
            AUD: { symbol: '$', space: true, rtl: false },
            BRL: { symbol: 'R$', space: true, rtl: false },
            CAD: { symbol: '$', space: true, rtl: false },
            CHF: { symbol: 'fr.', space: true, rtl: false },
            CLP: { symbol: '$', space: true, rtl: false },
            CNY: { symbol: '¥', space: true, rtl: false },
            CZK: {
                symbol: 'Kč',
                space: true,
                rtl: true,
                separatorSwap: true
            },
            DKK: {
                symbol: 'kr.',
                space: true,
                rtl: false,
                separatorSwap: true
            },
            EUR: {
                symbol: '€',
                space: false,
                rtl: false,
                separatorSwap: true
            },
            GBP: { symbol: '£', space: false, rtl: false },
            HKD: { symbol: 'HK$', space: true, rtl: false },
            HUF: {
                symbol: 'Ft',
                space: true,
                rtl: true,
                separatorSwap: true
            },
            INR: { symbol: '₹', space: true, rtl: false },
            JPY: { symbol: '¥', space: true, rtl: false },
            KRW: { symbol: '₩', space: true, rtl: false },
            NZD: { symbol: '$', space: true, rtl: false },
            PLN: { symbol: 'zł', space: true, rtl: true },
            RUB: {
                symbol: 'p.',
                space: true,
                rtl: true,
                separatorSwap: true
            },
            SAR: { symbol: '﷼', space: true, rtl: true },
            SEK: {
                symbol: 'kr',
                space: true,
                rtl: true,
                separatorSwap: true
            },
            SGD: { symbol: '$', space: false, rtl: false },
            THB: { symbol: '฿', space: true, rtl: true },
            TRY: { symbol: '₺', space: true, rtl: true },
            TWD: { symbol: '元', space: true, rtl: false }
        };

        if (symbol in symbolPairs) {
            // TODO: how do I get typescript less mad here?
            return symbolPairs[symbol];
        } else {
            return { symbol, space: true, rtl: false };
        }
    };

    @action getSymbol = () => {
        const { settings } = this.settingsStore;
        const { fiat } = settings;
        if (fiat) {
            const fiatEntry = this.fiatRates.filter(
                (entry: any) => entry.code === fiat
            )[0];
            return this.symbolLookup(fiatEntry.code);
        } else {
            console.log('no fiat?');
            // TODO: what do we do in this case?
            return { symbol: '???', space: true, rtl: true };
        }
    };

    @action
    public getRate = () => {
        const { settings } = this.settingsStore;
        const { fiat } = settings;
        if (fiat) {
            const fiatEntry = this.fiatRates.filter(
                (entry: any) => entry.code === fiat
            )[0];
            const rate = fiatEntry.rate;
            //const symbol = this.symbolLookup(fiatEntry.code);
            const symbol = '$';
            return `${symbol}${rate} BTC/${fiat}`;
        }
        return 'N/A';
    };

    @action
    public getFiatRates = () => {
        this.loading = true;
        RNFetchBlob.config({
            trusty: true
        })
            .fetch(
                'GET',
                'https://pay.zeusln.app/api/rates?storeId=Fjt7gLnGpg4UeBMFccLquy3GTTEz4cHU4PZMU63zqMBo'
            )
            .then((response: any) => {
                const status = response.info().status;
                if (status == 200) {
                    const data = response.json();
                    this.loading = false;
                    this.fiatRates = data;
                } else {
                    this.fiatRates = {};
                    this.loading = false;
                }
            })
            .catch(() => {
                this.fiatRates = {};
                this.loading = false;
            });
    };
}
