const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const cors = require('cors')

const app = express();
const corsOptions = {
  origin: '*', // Remplace par l'origine de ton frontend
  // methods: ['GET', 'POST', 'PUT', 'DELETE'], // Méthodes autorisées
  methods: ['*'], // Méthodes autorisées
  allowedHeaders: ['Content-Type', 'Authorization'], // En-têtes autorisés
};

app.use(cors(corsOptions));
app.use(express.json());
const server = http.createServer(app);
// const io = socketIo(server);
const io = socketIo(server, {
  cors: {
    origin: '*', // L'origine de ton frontend
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Permet d'envoyer des cookies et des informations d'authentification
  },
});

let worker;
let router;
const producers = [];

// Démarrer le worker mediasoup
(async () => {
    worker = await mediasoup.createWorker();
    console.log('Worker created');

    router = await worker.createRouter({
        mediaCodecs: [
            {
                kind: 'audio',
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            },
            {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
            },
        ],
    });
})();

app.get('/ping', (req, res) => {
  res.json({ data: 'Hello World!' });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('getRouterRtpCapabilities', (callback) => {
      callback(router.rtpCapabilities);
  });
    socket.on('createTransport', async (callback) => {
        const transport = await router.createWebRtcTransport({
            listenIps: [{ ip: '0.0.0.0', announcedIp: '192.168.88.4' }], // Remplacez par votre IP publique
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        });

        console.log('Transport created:', transport.id);

        callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });

        socket.on('connectTransport', async (dtlsParameters, callback) => {
            await transport.connect({ dtlsParameters });
            callback();
        });

        socket.on('produce', async ({ kind, rtpParameters }, callback) => {
            const producer = await transport.produce({ kind, rtpParameters });

            producers.push(producer);

            callback({ id: producer.id });
        });

        socket.on('consume', async (callback) => {
            const consumerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: 'YOUR_PUBLIC_IP' }],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            });

            const producer = producers.find(p => p.id !== socket.id);

            if (!producer) {
                return callback({ error: 'No producers found' });
            }

            const consumer = await consumerTransport.consume({
                producerId: producer.id,
                rtpCapabilities: router.rtpCapabilities,
                paused: false,
            });

            callback({
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                transportId: consumerTransport.id,
            });
        });
    });
});

// const baseUrl = window.location.protocol + '//' + window.location.hostname + ':4400'

server.listen(4400,'0.0.0.0', () => {
    console.log('Server is running on http://192.168.88.4:4400');
});
