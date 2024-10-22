// controllers/eventController.ts
import Blockchain from '../models/blockchain';
import WebSocket from 'ws';

class EventController {
  private clients: Set<WebSocket> = new Set();

  constructor() {
    this.init();
  }

  private init() {
    Blockchain.on('UniswapV2Mint', (data) => this.broadcast('UniswapV2Mint', data));
    Blockchain.on('UniswapV2Burn', (data) => this.broadcast('UniswapV2Burn', data));
    Blockchain.on('UniswapV2Swap', (data) => this.broadcast('UniswapV2Swap', data));

    Blockchain.on('UniswapV3Mint', (data) => this.broadcast('UniswapV3Mint', data));
    Blockchain.on('UniswapV3Burn', (data) => this.broadcast('UniswapV3Burn', data));
    Blockchain.on('UniswapV3Swap', (data) => this.broadcast('UniswapV3Swap', data));
  }

  public setClients(clients: Set<WebSocket>) {
    this.clients = clients;
  }

  private broadcast(eventType: string, data: object) {
    const payload = JSON.stringify({ event: eventType, data });
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}

export default new EventController();
