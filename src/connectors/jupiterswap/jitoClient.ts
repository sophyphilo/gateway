import axios, { AxiosInstance } from 'axios';

/**
 * Represents a JSON-RPC request structure.
 */
interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: any[];
}

/**
 * Represents the response from a JSON-RPC API.
 */
interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Represents the structure of a tip account.
 */
interface TipAccount {
  pubkey: string;
  lamports: number;
}

export class JitoJsonRpcClient {
  private baseUrl: string;
  private uuid?: string;
  private client: AxiosInstance;

  constructor(baseUrl: string, uuid?: string) {
    this.baseUrl = baseUrl;
    this.uuid = uuid;
    this.client = axios.create({
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Sends a JSON-RPC request to the specified endpoint.
   * @param endpoint The endpoint to send the request to.
   * @param method The JSON-RPC method to invoke.
   * @param params Parameters for the JSON-RPC method.
   */
  async sendRequest<T>(endpoint: string, method: string, params: any[] = []): Promise<JsonRpcResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const data: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    };

    console.log(`Sending request to: ${url}`);
    console.log(`Request body: ${JSON.stringify(data, null, 2)}`);

    try {
      const response = await this.client.post<JsonRpcResponse<T>>(url, data);
      console.log(`Response status: ${response.status}`);
      console.log(`Response body: ${JSON.stringify(response.data, null, 2)}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`HTTP error: ${error.message}`);
        throw error;
      } else {
        console.error(`Unexpected error: ${error}`);
        throw new Error('An unexpected error occurred');
      }
    }
  }

  /**
   * Retrieves all tip accounts.
   */
  async getTipAccounts(): Promise<JsonRpcResponse<TipAccount[]>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest<TipAccount[]>(endpoint, 'getTipAccounts');
  }

  /**
   * Retrieves a random tip account from the available accounts.
   */
  async getRandomTipAccount(): Promise<TipAccount> {
    const tipAccountsResponse = await this.getTipAccounts();
    if (tipAccountsResponse.result && Array.isArray(tipAccountsResponse.result) && tipAccountsResponse.result.length > 0) {
      const randomIndex = Math.floor(Math.random() * tipAccountsResponse.result.length);
      return tipAccountsResponse.result[randomIndex];
    } else {
      throw new Error('No tip accounts available');
    }
  }

  /**
   * Sends a transaction bundle.
   * @param params Parameters for the transaction bundle.
   */
  async sendBundle(params: any[]): Promise<JsonRpcResponse<any>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'sendBundle', params);
  }

  /**
   * Sends a single transaction.
   * @param params Parameters for the transaction.
   * @param bundleOnly Whether the transaction is for bundles only.
   */
  async sendTxn(params: any[], bundleOnly = false): Promise<JsonRpcResponse<any>> {
    let endpoint = '/transactions';
    const queryParams: string[] = [];

    if (bundleOnly) {
      queryParams.push('bundleOnly=true');
    }

    if (this.uuid) {
      queryParams.push(`uuid=${this.uuid}`);
    }

    if (queryParams.length > 0) {
      endpoint += `?${queryParams.join('&')}`;
    }

    return this.sendRequest(endpoint, 'sendTransaction', params);
  }

  /**
   * Retrieves the status of in-flight bundles.
   * @param params Parameters for querying bundle statuses.
   */
  async getInFlightBundleStatuses(params: any[]): Promise<JsonRpcResponse<any>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'getInflightBundleStatuses', params);
  }

  /**
   * Retrieves the statuses of bundles.
   * @param params Parameters for querying bundle statuses.
   */
  async getBundleStatuses(params: any[]): Promise<JsonRpcResponse<any>> {
    const endpoint = this.uuid ? `/bundles?uuid=${this.uuid}` : '/bundles';
    return this.sendRequest(endpoint, 'getBundleStatuses', params);
  }

  /**
   * Confirms the status of an in-flight bundle within a specified timeout.
   * @param bundleId The ID of the bundle to confirm.
   * @param timeoutMs Timeout in milliseconds.
   */
  async confirmInflightBundle(bundleId: string, timeoutMs = 60000): Promise<any> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await this.getInFlightBundleStatuses([[bundleId]]);
        if (response.result && response.result.length > 0) {
          const bundleStatus = response.result[0];
          console.log(`Bundle status: ${bundleStatus.status}, Landed slot: ${bundleStatus.landed_slot}`);

          if (bundleStatus.status === 'Failed') {
            return bundleStatus;
          } else if (bundleStatus.status === 'Landed') {
            const detailedStatus = await this.getBundleStatuses([[bundleId]]);
            if (detailedStatus.result && detailedStatus.result.length > 0) {
              return detailedStatus.result[0];
            } else {
              console.log('No detailed status returned for landed bundle.');
              return bundleStatus;
            }
          }
        } else {
          console.log('No status returned for the bundle. It may be invalid or very old.');
        }
      } catch (error) {
        console.error('Error checking bundle status:', error);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`Bundle ${bundleId} has not reached a final state within ${timeoutMs}ms`);
    return { status: 'Timeout' };
  }
}
