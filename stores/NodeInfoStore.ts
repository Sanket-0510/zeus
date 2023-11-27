import { action, observable } from 'mobx';
import NodeInfo from '../models/NodeInfo';
import ChannelsStore from './ChannelsStore';
import SettingsStore from './SettingsStore';
import { errorToUserFriendly } from '../utils/ErrorUtils';
import BackendUtils from '../utils/BackendUtils';

import Channel from '../models/Channel';

export default class NodeInfoStore {
    @observable public loading = false;
    @observable public error = false;
    @observable public errorMsg: string;
    @observable public nodeInfo: NodeInfo | any = {};
    @observable public networkInfo: any = {};
    @observable public testnet: boolean;
    @observable public regtest: boolean;
    channelsStore: ChannelsStore;
    settingsStore: SettingsStore;

    constructor(channelsStore: ChannelsStore, settingsStore: SettingsStore) {
        this.channelsStore = channelsStore;
        this.settingsStore = settingsStore;
    }

    reset = () => {
        this.error = false;
        this.loading = false;
        this.nodeInfo = {};
        this.regtest = false;
        this.testnet = false;
        this.errorMsg = '';
    };

    @action
    getNodeInfoError = () => {
        this.error = true;
        this.loading = false;
        this.nodeInfo = {};
    };

    @action
    setLoading = () => {
        this.loading = true;
    };

    private currentRequest: any;

    @action
    public getNodeInfo = () => {
        this.errorMsg = '';
        this.loading = true;
        const currentRequest = (this.currentRequest = {});
        return BackendUtils.getMyNodeInfo()
            .then((data: any) => {
                if (this.currentRequest !== currentRequest) {
                    return;
                }
                const nodeInfo = new NodeInfo(data);
                this.nodeInfo = nodeInfo;
                this.testnet = nodeInfo.isTestNet;
                this.regtest = nodeInfo.isRegTest;
                this.loading = false;
                this.error = false;
                return nodeInfo;
            })
            .catch((error: any) => {
                // handle error
                this.errorMsg = errorToUserFriendly(error.toString());
                this.getNodeInfoError();
            });
    };

    @action
    public getNetworkInfo = () => {
        this.errorMsg = '';
        this.loading = true;
        const currentRequest = (this.currentRequest = {});
        return BackendUtils.getNetworkInfo()
            .then((data: any) => {
                this.networkInfo = data;
                this.loading = false;
                this.error = false;
                return this.networkInfo;
            })
            .catch((error: any) => {
                if (this.currentRequest !== currentRequest) {
                    return;
                }
                // handle error
                this.errorMsg = errorToUserFriendly(error.toString());
                this.getNodeInfoError();
            });
    };

    @action
    public isLightningReadyToSend = async () => {
        await this.channelsStore.getChannels();
        await this.getNodeInfo();
        const syncedToChain = this.nodeInfo?.synced_to_chain;
        const syncedToGraph = this.nodeInfo?.synced_to_graph;
        const requireGraphSync = this.settingsStore?.settings?.waitForGraphSync;

        return (
            syncedToChain &&
            (!requireGraphSync || syncedToGraph) &&
            this.channelsStore.channels.some(
                (channel: Channel) => channel.active
            )
        );
    };

    @action
    public isLightningReadyToReceive = async () => {
        await this.channelsStore.getChannels();
        let syncedToChain = this.nodeInfo?.synced_to_chain;
        if (!syncedToChain) {
            await this.getNodeInfo();
            syncedToChain = this.nodeInfo?.synced_to_chain;
        }

        return (
            syncedToChain &&
            this.channelsStore.channels.some(
                (channel: Channel) => channel.active
            )
        );
    };
}
