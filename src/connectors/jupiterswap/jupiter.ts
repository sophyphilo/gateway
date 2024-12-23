import bs58 from 'bs58';
import Decimal from 'decimal.js-light';
import LRUCache from 'lru-cache';
// import { getPairData } from './jupiter.controller';
import { pow } from 'mathjs';

/*
import axios from 'axios';
import {
  JupiterQuoteResponse,
  SwapTransactionBuilderResponse,
} from './jupiter.request';
*/
import {
  AccountMeta,
  createJupiterApiClient,
  DefaultApi,
  Instruction,
  QuoteGetRequest,
  QuoteResponse,
} from '@jup-ag/api';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import { PriceRequest } from '../../amm/amm.requests';
import { Solana } from '../../chains/solana/solana';
import { getSolanaConfig } from '../../chains/solana/solana.config';
import { latency } from '../../services/base';
import { percentRegexp } from '../../services/config-manager-v2';
import { logger } from '../../services/logger';
import { JitoJsonRpcClient } from './jitoClient';
import { JupiterswapConfig } from './jupiterswap.config';

export class Jupiter {
  private static _instances: LRUCache<string, Jupiter>;
  private chain: Solana;
  private _ready: boolean = false;
  private _config: JupiterswapConfig.NetworkConfig;
  private jupiterApi: DefaultApi;
  // Jito 客户端实例
  private jitoClient: JitoJsonRpcClient;
  private jitoTipAccounts: string[] = [
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"
  ];

  private constructor(network: string) {
    this._config = JupiterswapConfig.config;
    this.chain = Solana.getInstance(network);

    this.jupiterApi = createJupiterApiClient({})

    // 初始化 Jito 客户端
    this.jitoClient = new JitoJsonRpcClient(
      'https://mainnet.block-engine.jito.wtf/api/v1',
      /*'YOUR_UUID_API_KEY',*/
    );
  }

  public static getInstance(network: string): Jupiter {
    const config = getSolanaConfig(network);
    if (Jupiter._instances === undefined) {
      Jupiter._instances = new LRUCache<string, Jupiter>({
        max: config.network.maxLRUCacheInstances,
      });
    }

    if (!Jupiter._instances.has(network)) {
      if (network !== null) {
        Jupiter._instances.set(network, new Jupiter(network));
      } else {
        throw new Error(
          `Solana.getInstance received an unexpected network: ${network}.`,
        );
      }
    }

    return Jupiter._instances.get(network) as Jupiter;
  }

  public async init() {
    if (!this.chain.ready()) {
      await this.chain.init();
    }
    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  getSlippage(): number {
    const allowedSlippage = this._config.allowedSlippage;
    const nd = allowedSlippage.match(percentRegexp);
    let slippage = 0.0;
    if (nd) slippage = Number(nd[1]) / Number(nd[2]);
    return slippage;
  }

  // async fetchData(baseToken: SolanaAsset, quoteToken: SolanaAsset) {
  //   return await
  // }
  // async estimateTrade(req: PriceRequest) {}

  async price(req: PriceRequest) {
    const baseSymbol = req.base.replace('_', '');
    const quoteSymbol = req.quote.replace('_', '');
    const startTimestamp: number = Date.now();
    const baseToken = this.chain.getAssetForSymbol(baseSymbol);
    const quoteToken = this.chain.getAssetForSymbol(quoteSymbol);
    if (!baseToken || !quoteToken) {
      throw new Error('INVALID TOKEN');
    }

    //const dexes = req.dexes || [];
    const onlyDirectRoutes = req.onlyDirectRoutes || true;

    const isBuy: boolean = req.side === 'BUY';
    const assetIn = isBuy ? quoteToken: baseToken;
    const assetOut = isBuy ? baseToken : quoteToken;
    const swapMode = isBuy ? 'ExactOut' : 'ExactIn';

    const amount = Number(req.amount) * <number>pow(10, baseToken.decimals);
    const params : QuoteGetRequest = {
      inputMint: assetIn?.address,
      outputMint: assetOut?.address,
      amount,
      swapMode,
      onlyDirectRoutes,
      restrictIntermediateTokens: true,
      slippageBps: 5,
    }
    const response = await this.jupiterApi.quoteGet(params);
    /*
    let baseURL = `https://quote-api.jup.ag/v6/quote?inputMint=${assetIn?.address}&outputMint=${assetOut?.address}&amount=${amount}&swapMode=${swapMode}&onlyDirectRoutes=${onlyDirectRoutes}&restrictIntermediateTokens=true&slippageBps=5`;
    if (dexes.length > 0) {
      baseURL += `&dexes=${dexes.length === 1 ? dexes[0] : dexes.join(',')}`;
    }
    const response = await axios.get<JupiterQuoteResponse>(baseURL);
    */
    logger.info(`Jupiter quote, response.data: ${JSON.stringify(response)}`);

    // 获取对应代币的 decimal 信息
    const inputDecimal = assetIn.decimals || 6;
    const outputDecimal = assetOut.decimals || 6;

    const inAmount = parseFloat(response.inAmount) / Math.pow(10, inputDecimal);
    const outAmount = parseFloat(response.outAmount) / Math.pow(10, outputDecimal);

    const price = isBuy ? (inAmount / outAmount) : (outAmount / inAmount);
    logger.info(
      `Best trade for ${baseToken.address}-${quoteToken.address}: ` +
        `${price.toFixed(6)}` +
        `${baseToken.symbol}.`
    );
    return {
      timestamp: startTimestamp,
      latency: latency(startTimestamp, Date.now()),
      base: baseToken.address,
      quote: quoteToken.address,
      amount: new Decimal(req.amount).toFixed(6),
      rawAmount: response.inAmount,
      expectedAmount: response.outAmount,
      price: price.toString(),
      gasPrice: 0.0001,
      gasLimit: 100000,
      expectedPrice: price,
      trade: response,
    };
  }

  async trade(quoteResponse: QuoteResponse, wallet: Keypair, jitoTip?: number, isStakedNode?: boolean, unitPrice?: number) {
    logger.info('Jupiter swap start');
    const response = await this.jupiterApi.swapInstructionsPost({
        swapRequest: {
            quoteResponse,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: false,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: {
              // This will set an optimized slippage to ensure high success rate
              maxBps: 5, // Make sure to set a reasonable cap here to prevent MEV
            },
            prioritizationFeeLamports: {
              jitoTipLamports: 1000,
            },
            skipUserAccountsRpcCalls: true,
        },
    });
    logger.info(`Jupiter swap, quote: ${JSON.stringify(quoteResponse)}, response: ${JSON.stringify(response)}`);
    const {
      computeBudgetInstructions,
      //setupInstructions,
      swapInstruction,
      //cleanupInstruction,
      addressLookupTableAddresses,
    } = response

    const unitPriceInstruction = (unitPrice === 0 || unitPrice == null) ? null : ComputeBudgetProgram.setComputeUnitPrice({
                                                                microLamports: unitPrice,
                                                            });

    const isJito = !(jitoTip === 0 || jitoTip == null)
    const randomIndex = Math.floor(Math.random() * this.jitoTipAccounts.length);
    const randomTipAccount = this.jitoTipAccounts[randomIndex]; //await this.jitoClient.getRandomTipAccount();
    const jitoTipAccount = new PublicKey(randomTipAccount);
    const jitoTipInstruction = (isJito && !isStakedNode && jitoTip) ? SystemProgram.transfer({
                                                          fromPubkey: wallet.publicKey,
                                                          toPubkey: jitoTipAccount,
                                                          lamports: jitoTip,
                                                        }) : null

    const instructions: TransactionInstruction[] = [
      ...computeBudgetInstructions.map(this.instructionDataToTransactionInstruction),
      unitPriceInstruction,
      //...setupInstructions.map(this.instructionDataToTransactionInstruction),
      this.instructionDataToTransactionInstruction(swapInstruction),
      //this.instructionDataToTransactionInstruction(cleanupInstruction),
      jitoTipInstruction
    ].filter((ix) => ix !== null) as TransactionInstruction[];

    const addressLookupTableAccounts = await this.getAdressLookupTableAccounts(
      addressLookupTableAddresses,
      this.chain.stakedConnection
    );

    const { blockhash, lastValidBlockHeight } = await this.chain.stakedConnection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(addressLookupTableAccounts);
    logger.info(`TransactionMessage constructed, messageV0: ${JSON.stringify(messageV0)}`);

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet]);

    //const base64Transaction = Buffer.from(rawTransaction).toString('base64');
    // const txid = await this.chain.connection.sendRawTransaction(rawTransaction, {
    //     skipPreflight: true,
    //     maxRetries: 2
    // });
    
    let txid = null;
    const currentSlot = await this.chain.stakedConnection.getSlot({ commitment: "confirmed" });
    //const slotProcessed = await this.chain.stakedConnection.getSlot({ commitment: "processed" });
    //const slotConfirmed = await this.chain.stakedConnection.getSlot({ commitment: "confirmed" });
    //const slotFinalized = await this.chain.stakedConnection.getSlot({ commitment: "finalized" });
    //console.log(`currentSlot: ${currentSlot}, slotProcessed: ${slotProcessed}, slotConfirmed: ${slotConfirmed}, slotFinalized: ${slotFinalized}`);
    if (isStakedNode) {
      const result = await this.chain.stakedConnection.sendTransaction(transaction, {
        maxRetries: 0,
        skipPreflight: true
      });
      txid = result;
      logger.info(`Jupiter sendRawTransaction use StakedNode, txid: ${txid}`);
      await this.chain.stakedConnection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'confirmed');
    } else if (isJito) {
      const rawTransaction = transaction.serialize();
      const base58Transaction = bs58.encode(rawTransaction);
      const result = await this.jitoClient.sendTxn([base58Transaction], false);
      txid = result.result;
      logger.info(`Jupiter sendRawTransaction use Jito, txid: ${txid}`);
      await this.chain.stakedConnection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'confirmed');
    } else {
      const result = await this.chain.connection.sendTransaction(transaction, {
        maxRetries: 0,
        skipPreflight: true
      });
      txid = result;
      logger.info(`Jupiter sendRawTransaction use NormalNode, txid: ${txid}`);
      await this.chain.connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'confirmed');
    }

    await this.checkTxStatus(this.chain.stakedConnection, txid, currentSlot)
    /*
    const result = await this.jitoClient.sendBundle([[base58Transaction]]);
    logger.info(`Jupiter sendBundle, bundleId: ${result.result}, result: ${result}`);

    const bundleId = result.result;
    const inflightStatus = await this.jitoClient.confirmInflightBundle(bundleId, 30000); // 120 seconds timeout
    console.log('Inflight bundle status:', JSON.stringify(inflightStatus, null, 2));

    let txid: string = '';
    if (inflightStatus.confirmation_status === "confirmed") {
      console.log(`Bundle successfully confirmed on-chain at slot ${inflightStatus.slot}`);

      // Additional check for bundle finalization
      try {
        console.log('Attempting to get bundle status...');
        const finalStatus = await this.jitoClient.getBundleStatuses([[bundleId]]); // Note the double array
        console.log('Final bundle status response:', JSON.stringify(finalStatus, null, 2));

        if (finalStatus.result && finalStatus.result.value && finalStatus.result.value.length > 0) {
          const status = finalStatus.result.value[0];
          console.log('Confirmation status:', status.confirmation_status);

          const explorerUrl = `https://explorer.jito.wtf/bundle/${bundleId}`;
          console.log('Bundle Explorer URL:', explorerUrl);

          console.log('Final bundle details:', status);

          // Updated section to handle and display multiple transactions
          if (status.transactions && status.transactions.length > 0) {
            console.log(`Transaction URLs (${status.transactions.length} transaction${status.transactions.length > 1 ? 's' : ''} in this bundle):`);
            status.transactions.forEach((transactionId: string, index: number) => {
              txid = transactionId;
              const txUrl = `https://solscan.io/tx/${transactionId}`;
              console.log(`Transaction ${index + 1}: ${txUrl}`);
            });
            if (status.transactions.length === 5) {
              console.log('Note: This bundle has reached the maximum of 5 transactions.');
            }
          } else {
            console.log('No transactions found in the bundle status.');
          }
        } else {
          console.log('Unexpected final bundle status response structure');
        }
      } catch (statusError: any) {
        console.error('Error fetching final bundle status:', statusError.message);
        if (statusError.response && statusError.response.data) {
          console.error('Server response:', statusError.response.data);
        }
      }
    } else if (inflightStatus.err) {
      console.log('Bundle processing failed:', inflightStatus.err);
    } else {
      console.log('Unexpected inflight bundle status:', inflightStatus);
    }
      */

    /*
    const swapTransactionBuf = Buffer.from(
      response.data.swapTransaction,
      'base64',
    );
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    logger.info(`Transaction deserialized, transaction: ${JSON.stringify(transaction)}`);    

    transaction.sign([wallet]);
    const latestBlockHash = await this.chain.connection.getLatestBlockhash();
    const rawTransaction = transaction.serialize();
    const base58Transaction = bs58.encode(rawTransaction);

    logger.info('Transaction serialized');

    const result = await this.jitoClient.sendTxn([base58Transaction], false);
    const txid = result.result;
    logger.info(`Jupiter sendRawTransaction, txid: ${txid}`);

    await this.chain.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: txid,
    }, 'confirmed');
    */
    logger.info(`Jupiter confirmTransaction completed, txid: ${txid}`);

    return { txid/*, ...response.data*/ };
  }

  private async checkTxStatus(connection: Connection, signature: string, slot: number): Promise<number> {
    const txn = await connection
      .getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 10,
      })
      .catch(() => {
        return null;
      });
  
    if (txn !== null) {
      const slotProcessed = txn.slot - slot;
      logger.info(
        `Transaction ${signature} landed in slot ${txn.slot}. Submitted in slot ${slot}. Processed in ${slotProcessed} slots.`
      );
      return slotProcessed;
    } else {
      logger.info(`Transaction ${signature} not landed.`);
    }
    return -1;
  }

  private instructionDataToTransactionInstruction (
    instruction: Instruction | undefined
  ) {
      if (instruction === null || instruction === undefined) return null;
      return new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.accounts.map((key: AccountMeta) => ({
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
          })),
          data: Buffer.from(instruction.data, "base64"),
      });
  };


  private async getAdressLookupTableAccounts (
    keys: string[], connection: Connection
  ): Promise<AddressLookupTableAccount[]> {
    const addressLookupTableAccountInfos =
        await connection.getMultipleAccountsInfo(
            keys.map((key) => new PublicKey(key))
        );

    return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
        const addressLookupTableAddress = keys[index];
        if (accountInfo) {
            const addressLookupTableAccount = new AddressLookupTableAccount({
                key: new PublicKey(addressLookupTableAddress),
                state: AddressLookupTableAccount.deserialize(accountInfo.data),
            });
            acc.push(addressLookupTableAccount);
        }

        return acc;
    }, new Array<AddressLookupTableAccount>());
  };

  // async trade(quoteResponse: JupiterQuoteResponse, wallet: Keypair) {
  //   logger.info('Jupiter swap start');
  //   const url = 'https://quote-api.jup.ag/v6/swap';
  //   const response = await axios.post<SwapTransactionBuilderResponse>(url, {
  //     quoteResponse,
  //     userPublicKey: wallet.publicKey.toString(),
  //     wrapAndUnwrapSol: false,
  //     dynamicComputeUnitLimit: true,
  //     dynamicSlippage: {
  //       // This will set an optimized slippage to ensure high success rate
  //       maxBps: 5, // Make sure to set a reasonable cap here to prevent MEV
  //     },
  //     //prioritizationFeeLamports: 'auto',
  //     //computeUnitPriceMicroLamports: 'auto',
  //     prioritizationFeeLamports: {
  //       jitoTipLamports: 100000,
  //       /*
  //       priorityLevelWithMaxLamports: {
  //         maxLamports: 100000,
  //         priorityLevel: "veryHigh" // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
  //       }
  //       */
  //     },
  //     skipUserAccountsRpcCalls: true,
  //     //destinationTokenAccount: wallet.publicKey.toString(),
  //     //useSharedAccounts: true,
  //     /*
  //     prioritizationFeeLamports: {
  //       autoMultiplier: 2,
  //     },
  //     */
  //   });
  //   logger.info(`Jupiter swap, quote: ${JSON.stringify(quoteResponse)}, response: ${JSON.stringify(response.data)}`);
  //   const swapTransactionBuf = Buffer.from(
  //     response.data.swapTransaction,
  //     'base64',
  //   );
  //   const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  //   logger.info(`Transaction deserialized, transaction: ${JSON.stringify(transaction)}`);    
  //   /*
  //   const randomTipAccount = await this.jitoClient.getRandomTipAccount(); // 获取 Jito 随机 Tip Account
  //   const jitoTipAccount = new PublicKey(randomTipAccount);

  //   // 添加优先级费用和 Jito Tip 转账指令
  //   const priorityFee = 1000; // 单位为 lamports，根据实际需求调整
  //   const jitoTipAmount = 5000; // 单位为 lamports，根据实际需求调整
  //   const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
  //     microLamports: priorityFee,
  //   });
  //   const tipInstruction = SystemProgram.transfer({
  //     fromPubkey: wallet.publicKey,
  //     toPubkey: jitoTipAccount,
  //     lamports: jitoTipAmount,
  //   });
  //   */

  //   transaction.sign([wallet]);
  //   const latestBlockHash = await this.chain.connection.getLatestBlockhash();
  //   const rawTransaction = transaction.serialize();
  //   const base58Transaction = bs58.encode(rawTransaction);

  //   logger.info('Transaction serialized');

  //   /*
  //   const txid = await this.chain.connection.sendRawTransaction(
  //     rawTransaction,
  //     {
  //       skipPreflight: true,
  //       preflightCommitment: 'confirmed',
  //     },
  //   );
  //   */
  //   const result = await this.jitoClient.sendTxn([base58Transaction], false);
  //   const txid = result.result;
  //   logger.info(`Jupiter sendRawTransaction, txid: ${txid}`);

  //   await this.chain.connection.confirmTransaction({
  //     blockhash: latestBlockHash.blockhash,
  //     lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
  //     signature: txid,
  //   }, 'confirmed');
  //   logger.info(`Jupiter confirmTransaction completed, txid: ${txid}`);

  //   return { txid, ...response.data };
  // }
}
