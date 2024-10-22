// src/websocket.ts
import WebSocket from 'ws';
//import config from './config/config';
import eventController from './controllers/eventController';

export class WebSocketServer {
    private wss: WebSocket.Server;
    private clients: Set<WebSocket>;

    constructor() {
        this.wss = new WebSocket.Server({ port: 35888/*config.port*/ });
        this.clients = new Set<WebSocket>();
        eventController.setClients(this.clients);
        //this.init();
    }

    init(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('New client connected');
            this.clients.add(ws);

            ws.on('close', () => {
                console.log('Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('message', (message: string) => {
                console.log('Received message from client:', message);
                // 可以根据需要处理客户端消息
            });

            // 发送欢迎消息
            ws.send(JSON.stringify({ message: 'Welcome to Uniswap Event WebSocket Server' }));
        });

        this.wss.on('listening', () => {
            console.log(`WebSocket Server is listening on port 35888`);
        });

        this.wss.on('error', (error: Error) => {
            console.error('WebSocket Server error:', error);
        });
    }
}
