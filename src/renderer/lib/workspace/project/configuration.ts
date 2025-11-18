
export interface NetworkConfiguration {
    allowHttp: boolean;
    allowRemoteResource: boolean;
    allowRemoteScript: boolean;
}

export interface ProjectAppConfiguration {
    network: NetworkConfiguration;
}
