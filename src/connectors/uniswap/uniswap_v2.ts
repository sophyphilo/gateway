import { UniswapishPriceError } from '../../services/error-handler';
import { isFractionString } from '../../services/validators';
import { UniswapConfig } from './uniswap.config';
import routerAbi from './uniswap_v2_router_abi.json';
//import { Trade } from '@uniswap/router-sdk';
import { Token, TradeType, CurrencyAmount, Percent, Currency } from '@uniswap/sdk-core';
import { Pair, Route, Trade as UniswapV2Trade } from '@uniswap/v2-sdk'

import { abi as IUniswapV2PairABI } from '@uniswap/v2-core/build/UniswapV2Pair.json';
import { abi as IUniswapV2FactoryABI } from '@uniswap/v2-core/build/UniswapV2Factory.json';

import { ContractInterface, ContractTransaction } from '@ethersproject/contracts';
import { BigNumber, Transaction, Wallet, Contract, constants } from 'ethers';
import { logger } from '../../services/logger';
import { percentRegexp } from '../../services/config-manager-v2';
import { Ethereum } from '../../chains/ethereum/ethereum';
import { Polygon } from '../../chains/polygon/polygon';
import { BinanceSmartChain } from "../../chains/binance-smart-chain/binance-smart-chain";
import { ExpectedTrade, Uniswapish } from '../../services/common-interfaces';
import { getAddress } from 'ethers/lib/utils';
import { Celo } from '../../chains/celo/celo';

export class UniswapV2 implements Uniswapish {
  private static _instances: { [name: string]: UniswapV2 };
  private chain: Ethereum | Polygon | BinanceSmartChain | Celo;
  private _router: string;
  private _routerAbi: ContractInterface;
  private _gasLimitEstimate: number;
  private _ttl: number;
  private chainId;
  private tokenList: Record<string, Token> = {};
  private _ready: boolean = false;
  private readonly _factoryAddress: string;

  private constructor(chain: string, network: string) {
    const config = UniswapConfig.config;
    if (chain === 'ethereum') {
      this.chain = Ethereum.getInstance(network);
    }/* else if (chain === 'polygon') {
      this.chain = Polygon.getInstance(network);
    } else if (chain === 'binance-smart-chain') {
      this.chain = BinanceSmartChain.getInstance(network);
    } else if (chain === 'celo')  {
      this.chain = Celo.getInstance(network);
    } */else {
      throw new Error('Unsupported chain');
    }

    this.chainId = this.chain.chainId;
    this._ttl = UniswapConfig.config.ttl;

    this._routerAbi = routerAbi.abi;
    this._gasLimitEstimate = UniswapConfig.config.gasLimitEstimate;
    this._router = config.uniswapV2RouterAddress(chain, network);
    this._factoryAddress = config.uniswapV2FactoryAddress(chain, network);
  }

  public static getInstance(chain: string, network: string): UniswapV2 {
    if (UniswapV2._instances === undefined) {
      UniswapV2._instances = {};
    }
    if (!(chain + network in UniswapV2._instances)) {
      UniswapV2._instances[chain + network] = new UniswapV2(chain, network);
    }

    return UniswapV2._instances[chain + network];
  }

  public getTokenByAddress(address: string): Token {
    return this.tokenList[getAddress(address)];
  }

  public async init() {
    if (!this.chain.ready()) {
      await this.chain.init();
    }
    for (const token of this.chain.storedTokenList) {
      this.tokenList[token.address] = new Token(
        this.chainId,
        token.address,
        token.decimals,
        token.symbol,
        token.name
      );
    }
    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  public get router(): string {
    return this._router;
  }

  public get routerAbi(): ContractInterface {
    return this._routerAbi;
  }

  public get gasLimitEstimate(): number {
    return this._gasLimitEstimate;
  }

  public get ttl(): number {
    return this._ttl;
  }

  public getAllowedSlippage(allowedSlippageStr?: string): Percent {
    if (allowedSlippageStr != null && isFractionString(allowedSlippageStr)) {
      const fractionSplit = allowedSlippageStr.split('/');
      return new Percent(fractionSplit[0], fractionSplit[1]);
    }

    const allowedSlippage = UniswapConfig.config.allowedSlippage;
    const nd = allowedSlippage.match(percentRegexp);
    if (nd) return new Percent(nd[1], nd[2]);
    throw new Error(
      'Encountered a malformed percent string in the config for ALLOWED_SLIPPAGE.'
    );
  }

  async estimateSellTrade(
    baseToken: Token,
    quoteToken: Token,
    amount: BigNumber,
    allowedSlippage?: string
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount = CurrencyAmount.fromRawAmount(baseToken, amount.toString());
    const pair = await this.getPair(baseToken, quoteToken);
    if (!pair) {
      throw new UniswapishPriceError(
        `priceSwapIn: no trade pair found for ${baseToken.address} to ${quoteToken.address}.`
      );
    }
    const route = new Route([pair], baseToken, quoteToken);
    const trade = new UniswapV2Trade(route, nativeTokenAmount, TradeType.EXACT_INPUT);
    logger.info(
        `Best trade for ${baseToken.address}-${quoteToken.address}: ` +
          `${trade.executionPrice.toFixed(6)}` +
          `${baseToken.symbol}.`
      );
    const expectedAmount = trade.minimumAmountOut(this.getAllowedSlippage(allowedSlippage));
    return { trade, expectedAmount };
  }

  async estimateBuyTrade(
    quoteToken: Token,
    baseToken: Token,
    amount: BigNumber,
    allowedSlippage?: string
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount = CurrencyAmount.fromRawAmount(baseToken, amount.toString());
    const pair = await this.getPair(quoteToken, baseToken);
    if (!pair) {
      throw new UniswapishPriceError(
        `priceSwapOut: no trade pair found for ${quoteToken.address} to ${baseToken.address}.`
      );
    }
    const route = new Route([pair], quoteToken, baseToken);
    const trade = new UniswapV2Trade(route, nativeTokenAmount, TradeType.EXACT_OUTPUT);
    logger.info(
        `Best trade for ${baseToken.address}-${quoteToken.address}: ` +
          `${trade.executionPrice.invert().toFixed(6)}` +
          `${baseToken.symbol}.`
      );
    const expectedAmount = trade.maximumAmountIn(this.getAllowedSlippage(allowedSlippage));
    return { trade, expectedAmount };
  }

  async executeTrade(
    wallet: Wallet,
    trade: UniswapV2Trade<Currency, Token, TradeType>,
    gasPrice: number,
    uniswapRouter: string,
    ttl: number,
    _abi: ContractInterface,
    gasLimit: number,
    nonce?: number,
    maxFeePerGas?: BigNumber,
    maxPriorityFeePerGas?: BigNumber,
    allowedSlippage?: string
  ): Promise<Transaction> {

      // 获取当前的 UNIX 时间戳并设置交易的过期时间
    const deadline = Math.floor(Date.now() / 1000) + ttl;

    // 解析交易路径
    const path = trade.route.path.map(token => token.address);

    // 交易金额及其滑点容差处理
    const amountIn = trade.inputAmount.quotient.toString();
    const amountOut = trade.outputAmount.quotient.toString();
    const slippageTolerance = this.getAllowedSlippage(allowedSlippage);

    let methodParameters: {  methodName?: string; args?: any[] };

    // 判断买入或卖出交易类型，并设置相应的参数
    if (trade.tradeType === TradeType.EXACT_INPUT) {
        // 卖出交易 (exact tokens in for min tokens out)
        const minimumAmountOut = trade.minimumAmountOut(slippageTolerance).quotient.toString();

        methodParameters = {
            methodName: "swapExactTokensForTokens",
            args: [amountIn, minimumAmountOut, path, wallet.address, deadline]
        };
    } else if (trade.tradeType === TradeType.EXACT_OUTPUT) {
        // 买入交易 (exact tokens out for max tokens in)
        const maximumAmountIn = trade.maximumAmountIn(slippageTolerance).quotient.toString();

        methodParameters = {
            methodName: "swapTokensForExactTokens",
            args: [amountOut, maximumAmountIn, path, wallet.address, deadline]
        };
    } else {
        throw new Error("Unsupported trade type.");
    }

    // 创建 Uniswap V2 Router 合约实例
    const router = new Contract(uniswapRouter, _abi, wallet);

    return this.chain.nonceManager.provideNonce(nonce, wallet.address, async nextNonce => {
        let tx: ContractTransaction;

        // 根据 gas 参数选择合适的发送交易配置
        const transactionOptions = {
            to: uniswapRouter,
            data: router.interface.encodeFunctionData(methodParameters.methodName!, methodParameters.args),
            gasLimit: gasLimit.toFixed(0),
            nonce: nextNonce,
            value: trade.inputAmount.currency.isNative ? amountIn : 0
        };

        // EIP-1559 交易或传统交易
        if (maxFeePerGas || maxPriorityFeePerGas) {
            tx = await wallet.sendTransaction({
                ...transactionOptions,
                maxFeePerGas,
                maxPriorityFeePerGas
            });
        } else {
            tx = await wallet.sendTransaction({
                ...transactionOptions,
                gasPrice: (gasPrice * 1e9).toFixed(0)
            });
        }

        logger.info(`Transaction sent: ${JSON.stringify(tx)}`);
        return tx;
    });
  }

  private async getPair(tokenA: Token, tokenB: Token): Promise<Pair | null> {
    const factory = new Contract(
      this._factoryAddress,
      IUniswapV2FactoryABI,
      this.chain.provider
    );
    const pairAddress = await factory.getPair(tokenA.address, tokenB.address);
    if (pairAddress === constants.AddressZero || pairAddress === undefined || pairAddress === '') {
      return null;
    }
    const pairContract = new Contract(pairAddress, IUniswapV2PairABI, this.chain.provider);

    // 获取配对的储备数据
    const [reserve0, reserve1] = await pairContract.getReserves();
    
    // 根据token顺序创建Pair实例
    const [token0, token1] = (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) ? [tokenA, tokenB] : [tokenB, tokenA];
    const pair = new Pair(CurrencyAmount.fromRawAmount(token0, reserve0), CurrencyAmount.fromRawAmount(token1, reserve1))
    return pair
  }
}
