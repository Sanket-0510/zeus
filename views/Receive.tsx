import * as React from 'react';
import {
    Dimensions,
    Image,
    NativeEventEmitter,
    NativeModules,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
    Platform
} from 'react-native';
import BigNumber from 'bignumber.js';
import { LNURLWithdrawParams } from 'js-lnurl';
import { ButtonGroup, Icon } from 'react-native-elements';
import { inject, observer } from 'mobx-react';
import _map from 'lodash/map';

import NfcManager, {
    NfcEvents,
    TagEvent,
    Ndef
} from 'react-native-nfc-manager';

import handleAnything from '../utils/handleAnything';

import Success from '../assets/images/GIF/Success.gif';
import Wordmark from '../assets/images/SVG/wordmark-black.svg';
import ZIcon from '../assets/images/icon-black.png';
import LightningIcon from '../assets/images/lightning-black.png';
import OnChainIcon from '../assets/images/onchain-black.png';
import ZPayIcon from '../assets/images/pay-z-black.png';

import Amount from '../components/Amount';
import AmountInput, { getSatAmount } from '../components/AmountInput';
import Button from '../components/Button';
import CollapsedQR from '../components/CollapsedQR';
import Header from '../components/Header';
import LoadingIndicator from '../components/LoadingIndicator';
import PaidIndicator from '../components/PaidIndicator';
import ModalBox from '../components/ModalBox';
import Screen from '../components/Screen';
import {
    SuccessMessage,
    WarningMessage,
    ErrorMessage
} from '../components/SuccessErrorMessage';
import Switch from '../components/Switch';
import Text from '../components/Text';
import TextInput from '../components/TextInput';
import { Row } from '../components/layout/Row';

import Invoice from '../models/Invoice';

import ChannelsStore from '../stores/ChannelsStore';
import ModalStore from '../stores/ModalStore';
import NodeInfoStore from '../stores/NodeInfoStore';
import InvoicesStore from '../stores/InvoicesStore';
import PosStore from '../stores/PosStore';
import SettingsStore from '../stores/SettingsStore';
import LightningAddressStore from '../stores/LightningAddressStore';
import LSPStore from '../stores/LSPStore';
import UnitsStore, { SATS_PER_BTC } from '../stores/UnitsStore';

import { localeString } from '../utils/LocaleUtils';
import BackendUtils from '../utils/BackendUtils';
import Base64Utils from '../utils/Base64Utils';
import NFCUtils from '../utils/NFCUtils';
import { themeColor } from '../utils/ThemeUtils';

import lndMobile from '../lndmobile/LndMobileInjection';
import { decodeSubscribeTransactionsResult } from '../lndmobile/onchain';
import {
    checkLndStreamErrorResponse,
    LndMobileEventEmitter
} from '../utils/LndMobileUtils';

import UnifiedSvg from '../assets/images/SVG/DynamicSVG/UnifiedSvg';
import LightningSvg from '../assets/images/SVG/DynamicSVG/LightningSvg';
import OnChainSvg from '../assets/images/SVG/DynamicSVG/OnChainSvg';
import AddressSvg from '../assets/images/SVG/DynamicSVG/AddressSvg';

interface ReceiveProps {
    exitSetup: any;
    navigation: any;
    ChannelsStore: ChannelsStore;
    InvoicesStore: InvoicesStore;
    PosStore: PosStore;
    ModalStore: ModalStore;
    NodeInfoStore: NodeInfoStore;
    SettingsStore: SettingsStore;
    UnitsStore: UnitsStore;
    LSPStore: LSPStore;
    LightningAddressStore: LightningAddressStore;
}

interface ReceiveState {
    selectedIndex: number;
    addressType: string;
    memo: string;
    value: string;
    satAmount: string | number;
    expiry: string;
    customPreimage: string;
    ampInvoice: boolean;
    routeHints: boolean;
    // POS
    orderId: string;
    orderTotal: string;
    orderTip: string;
    exchangeRate: string;
    rate: number;
    // LSP
    needInbound: boolean;
    belowMinAmount: boolean;
    enableLSP: boolean;
}

@inject(
    'ChannelsStore',
    'InvoicesStore',
    'SettingsStore',
    'UnitsStore',
    'PosStore',
    'NodeInfoStore',
    'LightningAddressStore',
    'LSPStore'
)
@observer
export default class Receive extends React.Component<
    ReceiveProps,
    ReceiveState
> {
    listener: any;
    listenerSecondary: any;
    lnInterval: any;
    onChainInterval: any;
    state = {
        selectedIndex: 0,
        addressType: '0',
        memo: '',
        value: '',
        satAmount: '',
        expiry: '3600',
        customPreimage: '',
        ampInvoice: false,
        routeHints: false,
        // POS
        orderId: '',
        orderTip: '',
        orderTotal: '',
        exchangeRate: '',
        rate: 0,
        // LSP
        needInbound: false,
        belowMinAmount: false,
        enableLSP: true
    };

    async UNSAFE_componentWillMount() {
        const {
            navigation,
            InvoicesStore,
            SettingsStore,
            LightningAddressStore
        } = this.props;
        const { reset } = InvoicesStore;
        const { getSettings, posStatus } = SettingsStore;
        const { status, lightningAddressHandle } = LightningAddressStore;

        const settings = await getSettings();

        if (settings?.lightningAddress?.enabled && !lightningAddressHandle) {
            status();
        }

        this.setState({
            addressType: settings?.invoices?.addressType || '0',
            memo: settings?.invoices?.memo || '',
            expiry: settings?.invoices?.expiry || '3600',
            routeHints: settings?.invoices?.routeHints || false,
            ampInvoice: settings?.invoices?.ampInvoice || false,
            enableLSP: settings?.enableLSP
        });

        const lnOnly =
            settings &&
            posStatus &&
            posStatus === 'active' &&
            settings.pos &&
            settings.pos.confirmationPreference &&
            settings.pos.confirmationPreference === 'lnOnly';

        reset();
        const lnurl: LNURLWithdrawParams | undefined =
            navigation.getParam('lnurlParams');

        const amount: string = navigation.getParam('amount');
        const autoGenerate: boolean = navigation.getParam('autoGenerate');
        const autoGenerateOnChain: boolean = navigation.getParam(
            'autoGenerateOnChain'
        );
        const selectedIndex: number = navigation.getParam('selectedIndex');

        if (selectedIndex) {
            this.setState({
                selectedIndex
            });
        }

        const { expiry, routeHints, ampInvoice, addressType } = this.state;

        // POS
        const memo: string = navigation.getParam('memo', this.state.memo);
        const orderId: string = navigation.getParam('orderId');
        const orderTotal: string = navigation.getParam('orderTotal');
        const orderTip: string = navigation.getParam('orderTip');
        const exchangeRate: string = navigation.getParam('exchangeRate');
        const rate: number = navigation.getParam('rate');

        if (orderId) {
            this.setState({
                orderId,
                orderTotal,
                orderTip,
                exchangeRate,
                rate
            });
        }

        if (lnurl) {
            this.props.UnitsStore.resetUnits();
            let needInbound = false;
            let belowMinAmount = false;
            if (
                BackendUtils.supportsLSPs() &&
                settings?.enableLSP &&
                new BigNumber(getSatAmount(lnurl.maxWithdrawable / 1000)).gt(
                    this.props.ChannelsStore.totalInbound
                )
            ) {
                needInbound = true;
                if (
                    new BigNumber(
                        getSatAmount(lnurl.maxWithdrawable / 1000)
                    ).lt(50000)
                ) {
                    belowMinAmount = true;
                }
            }
            this.setState({
                memo: lnurl.defaultDescription,
                value: (lnurl.maxWithdrawable / 1000).toString(),
                satAmount: getSatAmount(lnurl.maxWithdrawable / 1000),
                needInbound,
                belowMinAmount
            });
        }

        if (amount) {
            let needInbound = false;
            let belowMinAmount = false;
            if (
                BackendUtils.supportsLSPs() &&
                settings?.enableLSP &&
                getSatAmount(amount) != '0' &&
                new BigNumber(getSatAmount(amount)).gt(
                    this.props.ChannelsStore.totalInbound
                )
            ) {
                needInbound = true;
                if (new BigNumber(getSatAmount(amount)).lt(50000)) {
                    belowMinAmount = true;
                }
            }
            this.setState({
                value: amount,
                satAmount: getSatAmount(amount),
                needInbound,
                belowMinAmount
            });
        }

        if (lnOnly) {
            this.setState({
                selectedIndex: 1
            });
        }

        if (autoGenerate) {
            this.autoGenerateInvoice(
                getSatAmount(amount),
                memo,
                expiry,
                routeHints,
                ampInvoice,
                addressType
            );
        }

        if (autoGenerateOnChain) {
            this.autoGenerateOnChainAddress();
        }
    }

    async UNSAFE_componentWillReceiveProps(nextProps: any) {
        const { navigation, InvoicesStore, SettingsStore } = nextProps;
        const { reset } = InvoicesStore;
        const { settings } = SettingsStore;

        reset();
        const amount: string = navigation.getParam('amount');
        const lnurl: LNURLWithdrawParams | undefined =
            navigation.getParam('lnurlParams');

        if (amount) {
            let needInbound = false;
            let belowMinAmount = false;
            if (
                BackendUtils.supportsLSPs() &&
                settings?.enableLSP &&
                getSatAmount(amount) != '0' &&
                new BigNumber(getSatAmount(amount)).gt(
                    this.props.ChannelsStore.totalInbound
                )
            ) {
                needInbound = true;
                if (new BigNumber(getSatAmount(amount)).lt(50000)) {
                    belowMinAmount = true;
                }
            }
            this.setState({
                value: amount,
                satAmount: getSatAmount(amount),
                needInbound,
                belowMinAmount
            });
        }

        if (lnurl) {
            let needInbound = false;
            let belowMinAmount = false;
            if (
                BackendUtils.supportsLSPs() &&
                settings?.enableLSP &&
                new BigNumber(getSatAmount(lnurl.maxWithdrawable / 1000)).gt(
                    this.props.ChannelsStore.totalInbound
                )
            ) {
                needInbound = true;
                if (
                    new BigNumber(
                        getSatAmount(lnurl.maxWithdrawable / 1000)
                    ).lt(50000)
                ) {
                    belowMinAmount = true;
                }
            }
            this.setState({
                memo: lnurl.defaultDescription,
                value: (lnurl.maxWithdrawable / 1000).toString(),
                satAmount: getSatAmount(lnurl.maxWithdrawable / 1000),
                needInbound,
                belowMinAmount
            });
        }
    }

    clearListeners = () => {
        if (this.listener && this.listener.stop) this.listener.stop();
        if (this.listenerSecondary && this.listenerSecondary.stop)
            this.listenerSecondary.stop();
    };

    clearIntervals = () => {
        if (this.lnInterval) clearInterval(this.lnInterval);
        if (this.onChainInterval) clearInterval(this.onChainInterval);
    };

    onBack = () => {
        const { InvoicesStore } = this.props;
        const { reset } = InvoicesStore;
        // kill all listeners and pollers before navigating back
        this.clearListeners();
        this.clearIntervals();

        // clear invoice
        reset();
    };

    autoGenerateInvoice = (
        amount?: string,
        memo?: string,
        expiry?: string,
        routeHints?: boolean,
        ampInvoice?: boolean,
        addressType?: string
    ) => {
        const { InvoicesStore } = this.props;
        const { enableLSP } = this.state;
        const { createUnifiedInvoice } = InvoicesStore;

        createUnifiedInvoice(
            BackendUtils.supportsLSPs() && enableLSP ? '' : memo || '',
            amount || '0',
            expiry || '3600',
            undefined,
            enableLSP ? false : ampInvoice || false,
            enableLSP ? false : routeHints || false,
            BackendUtils.supportsAddressTypeSelection()
                ? addressType || '1'
                : undefined
        ).then(
            ({
                rHash,
                onChainAddress
            }: {
                rHash: string;
                onChainAddress?: string;
            }) => {
                this.subscribeInvoice(rHash, onChainAddress);
            }
        );
    };

    autoGenerateOnChainAddress = () => {
        const { InvoicesStore } = this.props;
        const { addressType } = this.state;
        const { getNewAddress } = InvoicesStore;

        getNewAddress({ type: addressType }).then((onChainAddress: string) => {
            this.subscribeInvoice(undefined, onChainAddress);
        });
    };

    disableNfc = () => {
        NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
        NfcManager.setEventListener(NfcEvents.SessionClosed, null);
    };

    enableNfc = async () => {
        const { ModalStore } = this.props;
        this.disableNfc();
        await NfcManager.start().catch((e) => console.warn(e.message));

        return new Promise((resolve: any) => {
            let tagFound: TagEvent | null = null;

            // enable NFC
            if (Platform.OS === 'android')
                ModalStore.toggleAndroidNfcModal(true);

            NfcManager.setEventListener(
                NfcEvents.DiscoverTag,
                (tag: TagEvent) => {
                    tagFound = tag;
                    const bytes = new Uint8Array(
                        tagFound.ndefMessage[0].payload
                    );

                    let str;
                    const decoded = Ndef.text.decodePayload(bytes);
                    if (decoded.match(/^(https?|lnurl)/)) {
                        str = decoded;
                    } else {
                        str = NFCUtils.nfcUtf8ArrayToStr(bytes) || '';
                    }

                    // close NFC
                    if (Platform.OS === 'android')
                        ModalStore.toggleAndroidNfcModal(false);

                    resolve(this.validateAddress(str));
                    NfcManager.unregisterTagEvent().catch(() => 0);
                }
            );

            NfcManager.setEventListener(NfcEvents.SessionClosed, () => {
                // close NFC
                if (Platform.OS === 'android')
                    ModalStore.toggleAndroidNfcModal(false);

                if (!tagFound) {
                    resolve();
                }
            });

            NfcManager.registerTagEvent();
        });
    };

    validateAddress = (text: string) => {
        const { navigation, InvoicesStore } = this.props;
        const { enableLSP } = this.state;
        const { createUnifiedInvoice } = InvoicesStore;
        const amount = getSatAmount(navigation.getParam('amount'));

        handleAnything(text, amount.toString())
            .then((response) => {
                try {
                    const [route, props] = response;
                    const { lnurlParams } = props;
                    const { memo } = lnurlParams.defaultDescription;

                    // if an amount was entered on the keypad screen before scanning
                    // we will automatically create an invoice and attempt to withdraw
                    // otherwise we present the user with the create invoice screen
                    if (Number(amount) > 0) {
                        createUnifiedInvoice(
                            BackendUtils.supportsLSPs() && enableLSP
                                ? ''
                                : memo,
                            amount.toString(),
                            '3600',
                            lnurlParams
                        )
                            .then(
                                ({
                                    rHash,
                                    onChainAddress
                                }: {
                                    rHash: string;
                                    onChainAddress?: string;
                                }) => {
                                    navigation.setParam;
                                    this.subscribeInvoice(
                                        rHash,
                                        onChainAddress
                                    );
                                }
                            )
                            .catch(() => {
                                navigation.navigate(route, {
                                    amount,
                                    ...props
                                });
                            });
                    } else {
                        navigation.navigate(route, props);
                    }
                } catch (e) {}
            })
            .catch();
    };

    subscribeInvoice = async (rHash?: string, onChainAddress?: string) => {
        const { InvoicesStore, PosStore, SettingsStore, NodeInfoStore } =
            this.props;
        const { orderId, orderTotal, orderTip, exchangeRate, rate, value } =
            this.state;
        const { implementation, settings } = SettingsStore;
        const { nodeInfo } = NodeInfoStore;
        const { setWatchedInvoicePaid } = InvoicesStore;

        const numConfPreference =
            settings.pos && settings.pos.confirmationPreference === '1conf'
                ? 1
                : 0;

        if (implementation === 'embedded-lnd') {
            if (rHash) {
                this.listener = LndMobileEventEmitter.addListener(
                    'SubscribeInvoices',
                    (e: any) => {
                        try {
                            const error = checkLndStreamErrorResponse(
                                'SubscribeInvoices',
                                e
                            );
                            if (error === 'EOF') {
                                return;
                            } else if (error) {
                                console.error(
                                    'Got error from SubscribeInvoices',
                                    [error]
                                );
                                return;
                            }

                            const invoice =
                                lndMobile.wallet.decodeInvoiceResult(e.data);

                            if (
                                invoice.settled &&
                                Base64Utils.bytesToHex(invoice.r_hash) === rHash
                            ) {
                                setWatchedInvoicePaid(
                                    Number(invoice.amt_paid_sat)
                                );
                                if (orderId)
                                    PosStore.recordPayment({
                                        orderId,
                                        orderTotal,
                                        orderTip,
                                        exchangeRate,
                                        rate,
                                        type: 'ln',
                                        tx: invoice.payment_request
                                    });
                                this.listener = null;
                            }
                        } catch (error) {
                            console.error(error);
                        }
                    }
                );
            }

            if (onChainAddress) {
                this.listenerSecondary = LndMobileEventEmitter.addListener(
                    'SubscribeTransactions',
                    (e: any) => {
                        try {
                            const error = checkLndStreamErrorResponse(
                                'SubscribeTransactions',
                                e
                            );
                            if (error === 'EOF') {
                                return;
                            } else if (error) {
                                console.error(
                                    'Got error from SubscribeTransactions',
                                    [error]
                                );
                                return;
                            }

                            const transaction =
                                decodeSubscribeTransactionsResult(e.data);
                            if (
                                onChainAddress &&
                                transaction.dest_addresses.includes(
                                    onChainAddress
                                ) &&
                                transaction.num_confirmations >
                                    numConfPreference &&
                                Number(transaction.amount) >= Number(value)
                            ) {
                                setWatchedInvoicePaid(
                                    Number(transaction.amount)
                                );
                                if (orderId)
                                    PosStore.recordPayment({
                                        orderId,
                                        orderTotal,
                                        orderTip,
                                        exchangeRate,
                                        rate,
                                        type: 'onchain',
                                        tx: transaction.tx_hash
                                    });
                                this.listenerSecondary = null;
                            }
                        } catch (error) {
                            console.error(error);
                        }
                    }
                );
            }

            await lndMobile.wallet.subscribeInvoices();
            await lndMobile.onchain.subscribeTransactions();
        }

        if (implementation === 'lightning-node-connect') {
            const { LncModule } = NativeModules;
            if (rHash) {
                const eventName = BackendUtils.subscribeInvoice(rHash);
                const eventEmitter = new NativeEventEmitter(LncModule);
                this.listener = eventEmitter.addListener(
                    eventName,
                    (event: any) => {
                        if (event.result) {
                            try {
                                const result = JSON.parse(event.result);
                                if (result.settled) {
                                    setWatchedInvoicePaid(result.amt_paid_sat);
                                    if (orderId)
                                        PosStore.recordPayment({
                                            orderId,
                                            orderTotal,
                                            orderTip,
                                            exchangeRate,
                                            rate,
                                            type: 'ln',
                                            tx: result.payment_request
                                        });
                                    this.listener = null;
                                }
                            } catch (error) {
                                console.error(error);
                            }
                        }
                    }
                );
            }

            if (onChainAddress) {
                const eventName2 = BackendUtils.subscribeTransactions();
                const eventEmitter2 = new NativeEventEmitter(LncModule);
                this.listenerSecondary = eventEmitter2.addListener(
                    eventName2,
                    (event: any) => {
                        if (event.result) {
                            try {
                                const result = JSON.parse(event.result);
                                if (
                                    result.dest_addresses.includes(
                                        onChainAddress
                                    ) &&
                                    result.num_confirmations >=
                                        numConfPreference &&
                                    Number(result.amount) >= Number(value)
                                ) {
                                    setWatchedInvoicePaid(result.amount);
                                    if (orderId)
                                        PosStore.recordPayment({
                                            orderId,
                                            orderTotal,
                                            orderTip,
                                            exchangeRate,
                                            rate,
                                            type: 'onchain',
                                            tx: result.tx_hash
                                        });
                                    this.listenerSecondary = null;
                                }
                            } catch (error) {
                                console.error(error);
                            }
                        }
                    }
                );
            }
        }

        if (implementation === 'lnd') {
            if (rHash) {
                this.lnInterval = setInterval(() => {
                    // only fetch the last 10 invoices
                    BackendUtils.getInvoices({ limit: 10 }).then(
                        (response: any) => {
                            const invoices = response.invoices;
                            for (let i = 0; i < invoices.length; i++) {
                                const result = invoices[i];
                                if (
                                    result.r_hash
                                        .replace(/\+/g, '-')
                                        .replace(/\//g, '_') === rHash &&
                                    Number(result.amt_paid_sat) >=
                                        Number(value) &&
                                    Number(result.amt_paid_sat) !== 0
                                ) {
                                    setWatchedInvoicePaid(result.amt_paid_sat);
                                    if (orderId)
                                        PosStore.recordPayment({
                                            orderId,
                                            orderTotal,
                                            orderTip,
                                            exchangeRate,
                                            rate,
                                            type: 'ln',
                                            tx: result.payment_request
                                        });
                                    this.clearIntervals();
                                    break;
                                }
                            }
                        }
                    );
                }, 5000);
            }

            // this is workaround that manually calls your transactions every 30 secs
            if (onChainAddress) {
                this.onChainInterval = setInterval(() => {
                    // only look for transactions in the last 3 blocks
                    BackendUtils.getTransactions(
                        nodeInfo && nodeInfo.block_height
                            ? {
                                  start_height: nodeInfo.block_height - 3
                              }
                            : null
                    ).then((response: any) => {
                        const txs = response.transactions;
                        for (let i = 0; i < txs.length; i++) {
                            const result = txs[i];
                            if (
                                result.dest_addresses.includes(
                                    onChainAddress
                                ) &&
                                result.num_confirmations >= numConfPreference
                            ) {
                                // loop through outputs since amount is negative if unconfirmed
                                const output_details = result.output_details;
                                for (
                                    let j = 0;
                                    j < output_details.length;
                                    j++
                                ) {
                                    const output = output_details[j];
                                    if (
                                        Number(output.amount) >=
                                            Number(value) &&
                                        output.address === onChainAddress
                                    ) {
                                        setWatchedInvoicePaid(output.amount);
                                        if (orderId)
                                            PosStore.recordPayment({
                                                orderId,
                                                orderTotal,
                                                orderTip,
                                                exchangeRate,
                                                rate,
                                                type: 'onchain',
                                                tx: result.tx_hash
                                            });
                                        this.clearIntervals();
                                        // break parent loop
                                        i = txs.length;
                                        break;
                                    }
                                }
                            }
                        }
                    });
                }, 7000);
            }
        }

        if (implementation === 'lndhub') {
            if (rHash) {
                this.lnInterval = setInterval(() => {
                    // only fetch the last 10 invoices
                    BackendUtils.getInvoices({ limit: 10 }).then(
                        (response: any) => {
                            const invoices = response.invoices;
                            for (let i = 0; i < invoices.length; i++) {
                                const result = new Invoice(invoices[i]);
                                if (
                                    result.getFormattedRhash === rHash &&
                                    result.ispaid &&
                                    Number(result.amt) >= Number(value) &&
                                    Number(result.amt) !== 0
                                ) {
                                    setWatchedInvoicePaid(result.amt);
                                    if (orderId)
                                        PosStore.recordPayment({
                                            orderId,
                                            orderTotal,
                                            orderTip,
                                            exchangeRate,
                                            rate,
                                            type: 'ln',
                                            tx: result.payment_request
                                        });
                                    this.clearIntervals();
                                    break;
                                }
                            }
                        }
                    );
                }, 5000);
            }
        }
    };

    getNewAddress = (params: any) => {
        const { InvoicesStore } = this.props;
        InvoicesStore.getNewAddress(params);
    };

    updateIndex = (selectedIndex: number) => {
        this.setState({
            selectedIndex
        });
    };

    render() {
        const {
            InvoicesStore,
            SettingsStore,
            UnitsStore,
            LightningAddressStore,
            LSPStore,
            NodeInfoStore,
            navigation
        } = this.props;
        const {
            selectedIndex,
            addressType,
            memo,
            value,
            satAmount,
            expiry,
            customPreimage,
            ampInvoice,
            routeHints,
            needInbound,
            belowMinAmount,
            enableLSP
        } = this.state;

        const { fontScale } = Dimensions.get('window');

        const { zeroConfFee, showLspSettings } = LSPStore;
        const { getAmount } = UnitsStore;

        const {
            createUnifiedInvoice,
            onChainAddress,
            payment_request,
            payment_request_amt,
            creatingInvoice,
            creatingInvoiceError,
            watchedInvoicePaid,
            watchedInvoicePaidAmt,
            clearUnified
        } = InvoicesStore;
        const { implementation, posStatus, settings, updateSettings } =
            SettingsStore;
        const loading = SettingsStore.loading || InvoicesStore.loading;
        const address = onChainAddress;
        const { lightningAddress } = LightningAddressStore;
        const lightningAddressLoading = LightningAddressStore.loading;

        const error_msg = LSPStore.error_msg || InvoicesStore.error_msg;

        const showCustomPreimageField =
            settings?.invoices?.showCustomPreimageField;

        const lnOnly =
            settings &&
            posStatus &&
            posStatus === 'active' &&
            settings.pos &&
            settings.pos.confirmationPreference &&
            settings.pos.confirmationPreference === 'lnOnly';

        const lnurl: LNURLWithdrawParams | undefined =
            navigation.getParam('lnurlParams');

        const ClearButton = () => (
            <Icon
                name="cancel"
                onPress={() => InvoicesStore.clearUnified()}
                color={themeColor('text')}
                underlayColor="transparent"
                size={30}
            />
        );

        const SettingsButton = () => (
            <Icon
                name="settings"
                onPress={() => this.refs.modal.open()}
                color={themeColor('text')}
                underlayColor="transparent"
                size={30}
            />
        );

        const ADDRESS_TYPES = BackendUtils.supportsTaproot()
            ? [
                  {
                      key: localeString('views.Receive.np2wkhKey'),
                      value: '1',
                      description: localeString(
                          'views.Receive.np2wkhDescription'
                      )
                  },
                  {
                      key: localeString('views.Receive.p2wkhKey'),
                      value: '0',
                      description: localeString(
                          'views.Receive.p2wkhDescription'
                      )
                  },
                  {
                      key: localeString('views.Receive.p2trKey'),
                      value: '4',
                      description: localeString('views.Receive.p2trDescription')
                  }
              ]
            : [
                  {
                      key: localeString('views.Receive.np2wkhKey'),
                      value: '1',
                      description: localeString(
                          'views.Receive.np2wkhDescriptionAlt'
                      )
                  },
                  {
                      key: localeString('views.Receive.p2wkhKey'),
                      value: '0',
                      description: localeString(
                          'views.Receive.p2wkhDescription'
                      )
                  }
              ];

        const unifiedButton = () => (
            <React.Fragment>
                <UnifiedSvg />
                <Text
                    style={{
                        color:
                            selectedIndex === 0
                                ? themeColor('background')
                                : themeColor('text'),
                        fontFamily: 'PPNeueMontreal-Book'
                    }}
                >
                    {localeString('general.unified')}
                </Text>
            </React.Fragment>
        );

        const lightningButton = () => (
            <React.Fragment>
                <LightningSvg />
                <Text
                    style={{
                        color:
                            selectedIndex === 1
                                ? themeColor('background')
                                : themeColor('text'),
                        fontFamily: 'PPNeueMontreal-Book'
                    }}
                >
                    {localeString('general.lightning')}
                </Text>
            </React.Fragment>
        );

        const onChainButton = () => (
            <React.Fragment>
                <OnChainSvg />
                <Text
                    style={{
                        color:
                            selectedIndex === 2
                                ? themeColor('background')
                                : themeColor('text'),
                        fontFamily: 'PPNeueMontreal-Book'
                    }}
                >
                    {localeString('general.onchain')}
                </Text>
            </React.Fragment>
        );

        const lightningAddressButton = () => (
            <React.Fragment>
                <AddressSvg />
                <Text
                    style={{
                        color:
                            selectedIndex === 3
                                ? themeColor('background')
                                : themeColor('text'),
                        fontFamily: 'PPNeueMontreal-Book'
                    }}
                >
                    {localeString('general.lightningAddressCondensed')}
                </Text>
            </React.Fragment>
        );

        const buttons =
            BackendUtils.supportsCustomPreimages() && !NodeInfoStore.testnet
                ? [
                      { element: unifiedButton },
                      { element: lightningButton },
                      { element: onChainButton },
                      { element: lightningAddressButton }
                  ]
                : [
                      { element: unifiedButton },
                      { element: lightningButton },
                      { element: onChainButton }
                  ];

        const haveUnifiedInvoice = !!payment_request && !!address;
        const haveInvoice = !!payment_request || !!address;

        let unifiedInvoice,
            lnInvoice,
            lnInvoiceCopyValue,
            btcAddress,
            btcAddressCopyValue;
        // if format is case insensitive, format as all caps to save QR space, otherwise present in original format
        const onChainFormatted =
            address && address === address.toLowerCase()
                ? address.toUpperCase()
                : address;
        if (haveUnifiedInvoice) {
            unifiedInvoice = `bitcoin:${onChainFormatted}?${`lightning=${payment_request.toUpperCase()}`}${
                Number(satAmount) > 0
                    ? `&amount=${new BigNumber(satAmount)
                          .dividedBy(SATS_PER_BTC)
                          .toFormat()}`
                    : ''
            }${memo ? `&message=${memo.replace(/ /g, '%20')}` : ''}`;
        }

        if (payment_request) {
            lnInvoice = `lightning:${payment_request.toUpperCase()}`;
            lnInvoiceCopyValue = payment_request;
        }

        if (address) {
            btcAddress = `bitcoin:${onChainFormatted}${
                (Number(satAmount) > 0 || memo) && '?'
            }${
                Number(satAmount) > 0
                    ? `amount=${new BigNumber(satAmount)
                          .dividedBy(SATS_PER_BTC)
                          .toFormat()}`
                    : ''
            }${
                memo
                    ? Number(satAmount) > 0
                        ? `&message=${memo.replace(/ /g, '%20')}`
                        : `message=${memo.replace(/ /g, '%20')}`
                    : ''
            }`;

            if (Number(satAmount) > 0 || memo) {
                btcAddressCopyValue = btcAddress;
            } else {
                btcAddressCopyValue = address;
            }
        }

        const belowDustLimit: boolean =
            Number(satAmount) !== 0 && Number(satAmount) < 546;

        const windowSize = Dimensions.get('window');

        return (
            <Screen>
                <Header
                    leftComponent="Back"
                    onBack={this.onBack}
                    centerComponent={{
                        text:
                            posStatus === 'active'
                                ? localeString('general.pay')
                                : localeString('views.Receive.title'),
                        style: {
                            color: themeColor('text'),
                            fontFamily: 'PPNeueMontreal-Book'
                        }
                    }}
                    rightComponent={
                        loading ||
                        watchedInvoicePaid ||
                        posStatus === 'active' ? null : haveInvoice ? (
                            <ClearButton />
                        ) : (
                            BackendUtils.supportsAddressTypeSelection() && (
                                <SettingsButton />
                            )
                        )
                    }
                    navigation={navigation}
                />

                <View style={{ flex: 1 }}>
                    {watchedInvoicePaid ? (
                        <View
                            style={{
                                alignItems: 'center',
                                justifyContent: 'space-evenly',
                                height: '100%'
                            }}
                        >
                            <PaidIndicator />
                            <Wordmark
                                height={windowSize.width * 0.2}
                                width={windowSize.width}
                                fill={themeColor('highlight')}
                            />
                            <View style={{ alignItems: 'center' }}>
                                <>
                                    <Image
                                        source={Success}
                                        style={{
                                            width: windowSize.width * 0.4,
                                            height: windowSize.width * 0.4
                                        }}
                                    />
                                    <Text
                                        style={{
                                            ...styles.text,
                                            fontSize:
                                                windowSize.width *
                                                windowSize.scale *
                                                0.017,
                                            alignSelf: 'center',
                                            color: themeColor('text'),
                                            textAlign: 'center'
                                        }}
                                    >
                                        {posStatus === 'active'
                                            ? localeString(
                                                  'views.Wallet.Invoices.paid'
                                              )
                                            : `${localeString(
                                                  'views.Receive.youReceived'
                                              )} ${getAmount(
                                                  watchedInvoicePaidAmt ||
                                                      payment_request_amt
                                              )}`}
                                    </Text>
                                </>
                            </View>
                            <Button
                                title={
                                    posStatus === 'active'
                                        ? localeString('general.goBack')
                                        : localeString(
                                              'views.SendingLightning.goToWallet'
                                          )
                                }
                                icon={{
                                    name: 'list',
                                    size: 25
                                }}
                                onPress={() => navigation.navigate('Wallet')}
                                containerStyle={{ width: '100%' }}
                            />
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.content}
                            keyboardShouldPersistTaps="handled"
                        >
                            {creatingInvoiceError && (
                                <ErrorMessage
                                    message={localeString(
                                        'views.Receive.errorCreate'
                                    )}
                                />
                            )}
                            {error_msg && <ErrorMessage message={error_msg} />}

                            {showLspSettings && (
                                <View style={{ margin: 10 }}>
                                    <Button
                                        title={localeString(
                                            'views.Receive.goToLspSettings'
                                        )}
                                        onPress={() =>
                                            navigation.navigate('LSPSettings')
                                        }
                                    />
                                </View>
                            )}

                            <View>
                                {!!payment_request && (
                                    <>
                                        {implementation === 'lndhub' &&
                                            !!address &&
                                            !belowDustLimit && (
                                                <WarningMessage
                                                    message={localeString(
                                                        'views.Receive.warningLndHub'
                                                    )}
                                                />
                                            )}
                                        {!!lnurl && (
                                            <SuccessMessage
                                                message={
                                                    !!lnurl &&
                                                    `${localeString(
                                                        'views.Receive.successCreate'
                                                    )} ${localeString(
                                                        'views.Receive.andSentTo'
                                                    )} ${lnurl.domain}`
                                                }
                                            />
                                        )}
                                    </>
                                )}
                                {(creatingInvoice || loading) && (
                                    <View style={{ marginTop: 40 }}>
                                        <LoadingIndicator />
                                    </View>
                                )}
                                {haveInvoice &&
                                    BackendUtils.supportsLSPs() &&
                                    enableLSP &&
                                    satAmount === '0' &&
                                    (selectedIndex === 0 ||
                                        selectedIndex === 1) && (
                                        <View
                                            style={{
                                                backgroundColor:
                                                    themeColor('secondary'),
                                                borderRadius: 10,
                                                top: 10,
                                                margin: 10,
                                                padding: 15,
                                                borderWidth: 0.5
                                            }}
                                        >
                                            <Text
                                                style={{
                                                    fontFamily:
                                                        'PPNeueMontreal-Medium',
                                                    color: themeColor('text'),
                                                    fontSize: 15
                                                }}
                                            >
                                                {localeString(
                                                    'views.Receive.lspZeroAmt'
                                                )}
                                            </Text>
                                        </View>
                                    )}
                                {haveInvoice &&
                                    !!zeroConfFee &&
                                    (selectedIndex == 0 ||
                                        selectedIndex == 1) && (
                                        <TouchableOpacity
                                            onPress={() =>
                                                navigation.navigate(
                                                    new BigNumber(
                                                        zeroConfFee
                                                    ).gt(1000)
                                                        ? 'LspExplanationFees'
                                                        : 'LspExplanationRouting'
                                                )
                                            }
                                        >
                                            <View
                                                style={{
                                                    backgroundColor:
                                                        themeColor('secondary'),
                                                    borderRadius: 10,
                                                    top: 10,
                                                    margin: 10,
                                                    padding: 15,
                                                    borderWidth: 0.5
                                                }}
                                            >
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Medium',
                                                        color: themeColor(
                                                            'text'
                                                        ),
                                                        marginBottom: 5
                                                    }}
                                                >
                                                    {localeString(
                                                        new BigNumber(
                                                            zeroConfFee
                                                        ).gt(1000)
                                                            ? selectedIndex ===
                                                              0
                                                                ? 'views.Receive.lspExplainerUnified'
                                                                : 'views.Receive.lspExplainer'
                                                            : selectedIndex ===
                                                              0
                                                            ? 'views.Receive.lspExplainerRoutingUnified'
                                                            : 'views.Receive.lspExplainerRouting'
                                                    )}
                                                </Text>
                                                <Amount
                                                    sats={zeroConfFee}
                                                    fixedUnits="sats"
                                                />
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Medium',
                                                        color: themeColor(
                                                            'secondaryText'
                                                        ),
                                                        fontSize: 15,
                                                        top: 5,
                                                        textAlign: 'right'
                                                    }}
                                                >
                                                    {localeString(
                                                        'general.tapToLearnMore'
                                                    )}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    )}
                                {haveInvoice && !creatingInvoiceError && (
                                    <View style={{ marginTop: 10 }}>
                                        {selectedIndex == 0 &&
                                            !belowDustLimit &&
                                            haveUnifiedInvoice && (
                                                <CollapsedQR
                                                    value={unifiedInvoice}
                                                    copyText={localeString(
                                                        'views.Receive.copyInvoice'
                                                    )}
                                                    expanded
                                                    textBottom
                                                    truncateLongValue
                                                    logo={ZIcon}
                                                />
                                            )}
                                        {selectedIndex == 1 &&
                                            !belowDustLimit &&
                                            haveUnifiedInvoice && (
                                                <CollapsedQR
                                                    value={lnInvoice}
                                                    copyValue={
                                                        lnInvoiceCopyValue
                                                    }
                                                    copyText={localeString(
                                                        'views.Receive.copyInvoice'
                                                    )}
                                                    expanded
                                                    textBottom
                                                    truncateLongValue
                                                    logo={LightningIcon}
                                                />
                                            )}
                                        {selectedIndex == 2 &&
                                            !belowDustLimit &&
                                            btcAddress && (
                                                <CollapsedQR
                                                    value={btcAddress}
                                                    copyValue={
                                                        btcAddressCopyValue
                                                    }
                                                    copyText={localeString(
                                                        'views.Receive.copyAddress'
                                                    )}
                                                    expanded
                                                    textBottom
                                                    truncateLongValue
                                                    logo={OnChainIcon}
                                                />
                                            )}

                                        {selectedIndex == 3 &&
                                            !lightningAddressLoading &&
                                            !lightningAddress && (
                                                <View
                                                    style={{
                                                        marginTop: 20,
                                                        marginBottom: 20
                                                    }}
                                                >
                                                    <Button
                                                        title={localeString(
                                                            'views.Receive.createLightningAddress'
                                                        )}
                                                        onPress={() =>
                                                            navigation.navigate(
                                                                'LightningAddress'
                                                            )
                                                        }
                                                    />
                                                </View>
                                            )}

                                        {selectedIndex == 3 &&
                                            !lightningAddressLoading && (
                                                <Row
                                                    style={{
                                                        alignSelf: 'center',
                                                        marginBottom: 15
                                                    }}
                                                >
                                                    <Text
                                                        style={{
                                                            fontFamily:
                                                                'PPNeueMontreal-Book',
                                                            fontSize:
                                                                26 / fontScale,
                                                            color: themeColor(
                                                                'text'
                                                            ),
                                                            textAlign: 'center'
                                                        }}
                                                    >
                                                        {lightningAddress}
                                                    </Text>
                                                </Row>
                                            )}

                                        {selectedIndex == 3 &&
                                            !lightningAddressLoading &&
                                            lightningAddress && (
                                                <CollapsedQR
                                                    value={lightningAddress}
                                                    copyText={localeString(
                                                        'views.Receive.copyAddress'
                                                    )}
                                                    expanded
                                                    textBottom
                                                    hideText
                                                    logo={ZPayIcon}
                                                />
                                            )}

                                        {selectedIndex == 3 &&
                                            lightningAddressLoading && (
                                                <View style={{ margin: 40 }}>
                                                    <LoadingIndicator />
                                                </View>
                                            )}

                                        {(selectedIndex === 0 ||
                                            selectedIndex === 1) &&
                                            (belowDustLimit ||
                                                !haveUnifiedInvoice) && (
                                                <CollapsedQR
                                                    value={lnInvoice}
                                                    copyValue={
                                                        lnInvoiceCopyValue
                                                    }
                                                    copyText={localeString(
                                                        'views.Receive.copyAddress'
                                                    )}
                                                    expanded
                                                    textBottom
                                                    truncateLongValue
                                                />
                                            )}
                                        {!(
                                            selectedIndex === 3 &&
                                            !lightningAddress
                                        ) && (
                                            <View
                                                style={[
                                                    styles.button,
                                                    { paddingTop: 0 }
                                                ]}
                                            >
                                                <Button
                                                    title={
                                                        posStatus === 'active'
                                                            ? localeString(
                                                                  'general.payNfc'
                                                              )
                                                            : localeString(
                                                                  'general.receiveNfc'
                                                              )
                                                    }
                                                    icon={{
                                                        name: 'nfc',
                                                        size: 25
                                                    }}
                                                    onPress={() =>
                                                        this.enableNfc()
                                                    }
                                                    secondary
                                                />
                                            </View>
                                        )}
                                    </View>
                                )}
                                {!loading && !haveInvoice && !creatingInvoice && (
                                    <>
                                        {BackendUtils.supportsLSPs() && (
                                            <>
                                                <Text
                                                    style={{
                                                        ...styles.secondaryText,
                                                        color: themeColor(
                                                            'secondaryText'
                                                        ),
                                                        top: 20
                                                    }}
                                                    infoText={[
                                                        localeString(
                                                            'views.Receive.lspSwitchExplainer1'
                                                        ),
                                                        localeString(
                                                            'views.Receive.lspSwitchExplainer2'
                                                        )
                                                    ]}
                                                    infoNav="LspExplanationOverview"
                                                >
                                                    {localeString(
                                                        'views.Settings.LSP.enableLSP'
                                                    )}
                                                </Text>
                                                <Switch
                                                    value={enableLSP}
                                                    onValueChange={async () => {
                                                        this.setState({
                                                            enableLSP:
                                                                !enableLSP
                                                        });
                                                        await updateSettings({
                                                            enableLSP:
                                                                !enableLSP
                                                        });
                                                    }}
                                                />
                                            </>
                                        )}

                                        {!(
                                            BackendUtils.supportsLSPs() &&
                                            enableLSP
                                        ) && (
                                            <>
                                                <Text
                                                    style={{
                                                        ...styles.secondaryText,
                                                        color: themeColor(
                                                            'secondaryText'
                                                        )
                                                    }}
                                                >
                                                    {localeString(
                                                        'views.Receive.memo'
                                                    )}
                                                </Text>
                                                <TextInput
                                                    placeholder={localeString(
                                                        'views.Receive.memoPlaceholder'
                                                    )}
                                                    value={memo}
                                                    onChangeText={(
                                                        text: string
                                                    ) => {
                                                        this.setState({
                                                            memo: text
                                                        });
                                                        clearUnified();
                                                    }}
                                                />
                                            </>
                                        )}

                                        <AmountInput
                                            amount={value}
                                            title={`${localeString(
                                                'views.Receive.amount'
                                            )} ${
                                                lnurl &&
                                                lnurl.minWithdrawable !==
                                                    lnurl.maxWithdrawable
                                                    ? ` (${Math.ceil(
                                                          lnurl.minWithdrawable /
                                                              1000
                                                      )} - ${Math.floor(
                                                          lnurl.maxWithdrawable /
                                                              1000
                                                      )})`
                                                    : ''
                                            }`}
                                            locked={
                                                lnurl &&
                                                lnurl.minWithdrawable ===
                                                    lnurl.maxWithdrawable
                                                    ? true
                                                    : false
                                            }
                                            onAmountChange={(
                                                amount: string,
                                                satAmount: string | number
                                            ) => {
                                                let needInbound = false;
                                                let belowMinAmount = false;
                                                if (
                                                    BackendUtils.supportsLSPs() &&
                                                    enableLSP &&
                                                    satAmount != '0' &&
                                                    new BigNumber(satAmount).gt(
                                                        this.props.ChannelsStore
                                                            .totalInbound
                                                    )
                                                ) {
                                                    needInbound = true;
                                                    if (
                                                        new BigNumber(
                                                            satAmount
                                                        ).lt(50000)
                                                    ) {
                                                        belowMinAmount = true;
                                                    }
                                                }
                                                this.setState({
                                                    value: amount,
                                                    satAmount,
                                                    needInbound,
                                                    belowMinAmount
                                                });
                                            }}
                                        />

                                        {needInbound && (
                                            <TouchableOpacity
                                                onPress={() =>
                                                    navigation.navigate(
                                                        'LspExplanationFees'
                                                    )
                                                }
                                            >
                                                <View
                                                    style={{
                                                        backgroundColor:
                                                            themeColor(
                                                                'secondary'
                                                            ),
                                                        borderRadius: 10,
                                                        borderColor:
                                                            themeColor(
                                                                'highlight'
                                                            ),
                                                        padding: 15,
                                                        borderWidth: 0.5,
                                                        top: 5,
                                                        marginBottom: 20
                                                    }}
                                                >
                                                    <Text
                                                        style={{
                                                            fontFamily:
                                                                'PPNeueMontreal-Medium',
                                                            color: themeColor(
                                                                'text'
                                                            ),
                                                            fontSize: 15
                                                        }}
                                                    >
                                                        {belowMinAmount &&
                                                        this.props.ChannelsStore
                                                            .channels.length ===
                                                            0
                                                            ? localeString(
                                                                  'views.Wallet.KeypadPane.lspExplainerFirstChannel'
                                                              )
                                                            : belowMinAmount
                                                            ? localeString(
                                                                  'views.Wallet.KeypadPane.lspExplainerBelowMin'
                                                              )
                                                            : localeString(
                                                                  'views.Wallet.KeypadPane.lspExplainer'
                                                              )}
                                                    </Text>
                                                    <Text
                                                        style={{
                                                            fontFamily:
                                                                'PPNeueMontreal-Medium',
                                                            color: themeColor(
                                                                'secondaryText'
                                                            ),
                                                            fontSize: 15,
                                                            top: 5,
                                                            textAlign: 'right'
                                                        }}
                                                    >
                                                        {localeString(
                                                            'general.tapToLearnMore'
                                                        )}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                        )}

                                        {implementation !== 'lndhub' && (
                                            <>
                                                <Text
                                                    style={{
                                                        ...styles.secondaryText,
                                                        color: themeColor(
                                                            'secondaryText'
                                                        )
                                                    }}
                                                >
                                                    {localeString(
                                                        'views.Receive.expiration'
                                                    )}
                                                </Text>
                                                <TextInput
                                                    keyboardType="numeric"
                                                    placeholder={
                                                        '3600 (one hour)'
                                                    }
                                                    value={expiry}
                                                    onChangeText={(
                                                        text: string
                                                    ) =>
                                                        this.setState({
                                                            expiry: text
                                                        })
                                                    }
                                                />
                                            </>
                                        )}

                                        {BackendUtils.supportsCustomPreimages() &&
                                            showCustomPreimageField && (
                                                <>
                                                    <Text
                                                        style={{
                                                            ...styles.secondaryText,
                                                            color: themeColor(
                                                                'secondaryText'
                                                            )
                                                        }}
                                                    >
                                                        {localeString(
                                                            'views.Receive.customPreimage'
                                                        )}
                                                    </Text>
                                                    <TextInput
                                                        value={customPreimage}
                                                        onChangeText={(
                                                            text: string
                                                        ) =>
                                                            this.setState({
                                                                customPreimage:
                                                                    text
                                                            })
                                                        }
                                                    />
                                                </>
                                            )}

                                        {BackendUtils.isLNDBased() &&
                                            !(
                                                BackendUtils.supportsLSPs() &&
                                                enableLSP
                                            ) && (
                                                <>
                                                    <Text
                                                        style={{
                                                            ...styles.secondaryText,
                                                            color: themeColor(
                                                                'secondaryText'
                                                            ),
                                                            top: 20
                                                        }}
                                                        infoText={[
                                                            localeString(
                                                                'views.Receive.routeHintSwitchExplainer1'
                                                            ),
                                                            localeString(
                                                                'views.Receive.routeHintSwitchExplainer2'
                                                            )
                                                        ]}
                                                    >
                                                        {localeString(
                                                            'views.Receive.routeHints'
                                                        )}
                                                    </Text>
                                                    <Switch
                                                        value={routeHints}
                                                        onValueChange={() =>
                                                            this.setState({
                                                                routeHints:
                                                                    !routeHints
                                                            })
                                                        }
                                                    />
                                                </>
                                            )}

                                        {BackendUtils.supportsAMP() &&
                                            !(
                                                BackendUtils.supportsLSPs() &&
                                                enableLSP
                                            ) && (
                                                <>
                                                    <Text
                                                        style={{
                                                            ...styles.secondaryText,
                                                            color: themeColor(
                                                                'secondaryText'
                                                            ),
                                                            top: 20
                                                        }}
                                                        infoText={[
                                                            localeString(
                                                                'views.Receive.ampSwitchExplainer1'
                                                            ),
                                                            localeString(
                                                                'views.Receive.ampSwitchExplainer2'
                                                            )
                                                        ]}
                                                        infoLink="https://docs.lightning.engineering/lightning-network-tools/lnd/amp"
                                                    >
                                                        {localeString(
                                                            'views.Receive.ampInvoice'
                                                        )}
                                                    </Text>
                                                    <Switch
                                                        value={ampInvoice}
                                                        onValueChange={() =>
                                                            this.setState({
                                                                ampInvoice:
                                                                    !ampInvoice
                                                            })
                                                        }
                                                    />
                                                </>
                                            )}

                                        <View style={styles.button}>
                                            <Button
                                                title={
                                                    localeString(
                                                        'views.Receive.createInvoice'
                                                    ) +
                                                    (lnurl
                                                        ? ` ${localeString(
                                                              'views.Receive.andSubmitTo'
                                                          )} ${lnurl.domain}`
                                                        : '')
                                                }
                                                onPress={() => {
                                                    createUnifiedInvoice(
                                                        BackendUtils.supportsLSPs() &&
                                                            enableLSP
                                                            ? ''
                                                            : memo,
                                                        satAmount.toString() ||
                                                            '0',
                                                        expiry,
                                                        lnurl,
                                                        BackendUtils.supportsLSPs() &&
                                                            enableLSP
                                                            ? false
                                                            : ampInvoice ||
                                                                  false,
                                                        routeHints,
                                                        BackendUtils.supportsAddressTypeSelection()
                                                            ? addressType
                                                            : undefined,
                                                        BackendUtils.supportsCustomPreimages() &&
                                                            showCustomPreimageField
                                                            ? customPreimage
                                                            : undefined
                                                    ).then(
                                                        ({
                                                            rHash,
                                                            onChainAddress
                                                        }: {
                                                            rHash: string;
                                                            onChainAddress?: string;
                                                        }) => {
                                                            this.subscribeInvoice(
                                                                rHash,
                                                                onChainAddress
                                                            );
                                                        }
                                                    );
                                                }}
                                                disabled={belowMinAmount}
                                            />
                                        </View>
                                    </>
                                )}
                            </View>
                        </ScrollView>
                    )}
                </View>
                <View style={{ bottom: 0 }}>
                    {!belowDustLimit && haveUnifiedInvoice && !lnOnly && (
                        <ButtonGroup
                            onPress={this.updateIndex}
                            selectedIndex={selectedIndex}
                            buttons={buttons}
                            selectedButtonStyle={{
                                backgroundColor: themeColor('highlight'),
                                borderRadius: 12
                            }}
                            containerStyle={{
                                backgroundColor: themeColor('secondary'),
                                borderRadius: 12,
                                borderColor: themeColor('secondary'),
                                height: 80
                            }}
                            innerBorderStyle={{
                                color: themeColor('secondary')
                            }}
                        />
                    )}
                </View>
                <ModalBox
                    style={{
                        backgroundColor: themeColor('background'),
                        borderTopLeftRadius: 20,
                        borderTopRightRadius: 20,
                        height: BackendUtils.supportsTaproot() ? 450 : 350,
                        paddingLeft: 24,
                        paddingRight: 24
                    }}
                    swipeToClose={true}
                    backButtonClose={true}
                    position="bottom"
                    ref="modal"
                >
                    <Text
                        style={{
                            color: themeColor('text'),
                            fontSize: 24,
                            fontWeight: 'bold',
                            paddingTop: 24,
                            paddingBottom: 24
                        }}
                    >
                        {localeString('views.Receive.addressType')}
                    </Text>
                    {_map(ADDRESS_TYPES, (d, index) => (
                        <TouchableOpacity
                            key={index}
                            onPress={() => {
                                InvoicesStore.clearAddress();
                                this.setState({ addressType: d.value });
                                this.refs.modal.close();
                            }}
                            style={{
                                backgroundColor: themeColor('secondary'),
                                borderColor:
                                    d.value === addressType
                                        ? themeColor('highlight')
                                        : themeColor('secondaryText'),
                                borderRadius: 4,
                                borderWidth: d.value === addressType ? 2 : 1,
                                padding: 16,
                                marginBottom: 24
                            }}
                        >
                            <Text
                                style={{
                                    color: themeColor('text'),
                                    fontSize: 16,
                                    fontWeight: 'bold',
                                    marginBottom: 4
                                }}
                            >
                                {d.key}
                            </Text>
                            <Text
                                style={{
                                    color: themeColor('text'),
                                    fontSize: 16,
                                    fontWeight: 'normal'
                                }}
                            >
                                {d.description}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ModalBox>
            </Screen>
        );
    }
}

const styles = StyleSheet.create({
    content: {
        paddingLeft: 20,
        paddingRight: 20
    },
    button: {
        paddingTop: 25,
        paddingBottom: 15
    },
    text: {
        fontFamily: 'PPNeueMontreal-Book'
    },
    secondaryText: {
        fontFamily: 'PPNeueMontreal-Book'
    }
});
