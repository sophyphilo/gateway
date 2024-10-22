import { ethers } from 'ethers';
//import config from '../config/config';
import { EventEmitter } from 'events';

interface UniswapEvent {
  sender: string;
  amount0?: string;
  amount1?: string;
  to?: string;
  owner?: string;
  tickLower?: number;
  tickUpper?: number;
  amount?: string;
  sqrtPriceX96?: string;
  liquidity?: string;
  tick?: number;
}

class Blockchain extends EventEmitter {
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
    super();
    this.provider = new ethers.providers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/QAKzzYEfH1dIy2ts6Rjp-ZIlr95iohBb');
    this.initUniswapV2();
    this.initUniswapV3();
  }

  private initUniswapV2() {
    console.log("initUniswapV2");
    const uniswapV2Abi = [
      "event Mint(address indexed sender, uint amount0, uint amount1)",
      "event Burn(address indexed sender, uint amount0, uint amount1)",
      "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
    ];

    const pairAddress = '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852'; // 替换为实际地址
    const pairContract = new ethers.Contract(pairAddress, uniswapV2Abi, this.provider);

    pairContract.on('Mint', (sender: string, amount0: ethers.BigNumber, amount1: ethers.BigNumber) => {
      const eventData: UniswapEvent = { sender, amount0: amount0.toString(), amount1: amount1.toString() };
      this.emit('UniswapV2Mint', eventData);
    });

    pairContract.on('Burn', (sender: string, amount0: ethers.BigNumber, amount1: ethers.BigNumber) => {
      const eventData: UniswapEvent = { sender, amount0: amount0.toString(), amount1: amount1.toString() };
      this.emit('UniswapV2Burn', eventData);
    });

    pairContract.on('Swap', (sender: string, amount0In: ethers.BigNumber, amount1In: ethers.BigNumber, to: string) => {
      const eventData: UniswapEvent = {
        sender,
        amount0: amount0In.toString(),
        amount1: amount1In.toString(),
        to,
      };
      this.emit('UniswapV2Swap', eventData);
      console.log("initUniswapV2, Swap: ", JSON.stringify(eventData));
    });
  }

  private initUniswapV3() {
    console.log("initUniswapV3");
    const uniswapV3Abi = [
      "event Mint(address sender, address indexed owner, int24 tickLower, int24 tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
      "event Burn(address indexed owner, int24 tickLower, int24 tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
      "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
    ];

    const poolAddress = '0x11b815efB8f581194ae79006d24E0d814B7697F6';
    const poolContract = new ethers.Contract(poolAddress, uniswapV3Abi, this.provider);

    poolContract.on('Mint', (sender: string, owner: string, tickLower: number, tickUpper: number, amount: ethers.BigNumber, amount0: ethers.BigNumber, amount1: ethers.BigNumber) => {
      const eventData: UniswapEvent = {
        sender,
        owner,
        tickLower,
        tickUpper,
        amount: amount.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      };
      this.emit('UniswapV3Mint', eventData);
    });

    poolContract.on('Burn', (owner: string, tickLower: number, tickUpper: number, amount: ethers.BigNumber, amount0: ethers.BigNumber, amount1: ethers.BigNumber) => {
      const eventData: UniswapEvent = {
        sender: owner,  // 使用 `owner` 作为 `sender`
        owner,
        tickLower,
        tickUpper,
        amount: amount.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      };
      this.emit('UniswapV3Burn', eventData);
    });

    poolContract.on('Swap', (sender: string, recipient: string, amount0: ethers.BigNumber, amount1: ethers.BigNumber, sqrtPriceX96: ethers.BigNumber, liquidity: ethers.BigNumber, tick: number) => {
      const eventData: UniswapEvent = {
        sender,
        to: recipient,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        sqrtPriceX96: sqrtPriceX96.toString(),
        liquidity: liquidity.toString(),
        tick,
      };
      this.emit('UniswapV3Swap', eventData);
      console.log("initUniswapV3, Swap: ", JSON.stringify(eventData));
    });
  }
}

export default new Blockchain();
