// config/config.ts
import dotenv from 'dotenv';

dotenv.config();

interface Config {
  infuraProjectId: string;
  uniswapV2FactoryAddress: string;
  uniswapV3FactoryAddress: string;
  port: number;
}

const config: Config = {
  infuraProjectId: process.env.INFURA_PROJECT_ID || '',
  uniswapV2FactoryAddress: process.env.UNISWAP_V2_FACTORY_ADDRESS || '',
  uniswapV3FactoryAddress: process.env.UNISWAP_V3_FACTORY_ADDRESS || '',
  port: parseInt(process.env.PORT || '8080', 10),
};

export default config;
