import { action, observable } from 'mobx';
// LN
import Payment from './../models/Payment';
import Invoice from './../models/Invoice';
// on-chain
import Transaction from './../models/Transaction';

import SettingsStore from './SettingsStore';
import PaymentsStore from './PaymentsStore';
import InvoicesStore from './InvoicesStore';
import TransactionsStore from './TransactionsStore';

export default class ActivityStore {
    @observable public loading: boolean = false;
    @observable public error: boolean = false;
    @observable public activity: Array<Invoice | Payment | Transaction> = [];

    settingsStore: SettingsStore;
    paymentsStore: PaymentsStore;
    invoicesStore: InvoicesStore;
    transactionsStore: TransactionsStore;

    constructor(
        settingsStore: SettingsStore,
        paymentsStore: PaymentsStore,
        invoicesStore: InvoicesStore,
        transactionsStore: TransactionsStore
    ) {
        this.settingsStore = settingsStore;
        this.paymentsStore = paymentsStore;
        this.transactionsStore = transactionsStore;
        this.invoicesStore = invoicesStore;
    }

    @action
    public getActivity = async () => {
        this.loading = true;
        this.activity = [];
        await this.paymentsStore.getPayments();
        await this.transactionsStore.getTransactions();
        await this.invoicesStore.getInvoices();
        const activity = [];
        const payments = this.paymentsStore.payments;
        const transactions = this.transactionsStore.transactions;
        const invoices = this.invoicesStore.invoices;

        // push payments, txs, invoices to one array
        activity.push.apply(
            activity,
            payments.concat(transactions).concat(invoices)
        );
        // sort activity by timestamp
        const sortedActivity = activity.sort((a, b) =>
            a.getTimestamp < b.getTimestamp ? 1 : -1
        );

        this.activity = sortedActivity;

        this.loading = false;
    };
}
