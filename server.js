const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let lampuState = "off";  // Status lampu
let currentTemperature = 0;
let currentHumidity = 0;

// Setup Serial Port (gunakan COM5)
const port = new SerialPort({ path: "COM5", baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));

// Middleware untuk parsing JSON
app.use(express.json());

// Static HTML
app.use(express.static(__dirname + "/views"));

// Route untuk toggle lampu (mengirimkan perintah melalui serial)
app.post("/toggleLamp", (req, res) => {
    try {
        if (!req.body || !req.body.action) {
            return res.status(400).json({ error: "Action parameter is required" });
        }

        const command = req.body.action === 'on' ? "LAMP_ON" : "LAMP_OFF";
        console.log(`Sending ${command} command to ESP32`);
        port.write(command + '\n', (err) => {  // Tambahkan newline untuk pemisahan perintah
            if (err) {
                console.log("Error writing to serial port: ", err);
                return res.status(500).json({ error: "Failed to toggle lamp" });
            }
            console.log("Lamp command sent successfully");
            lampuState = req.body.action;
            return res.json({ success: true });
        });
    } catch (err) {
        console.log("Error handling request: ", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Handle data dari serial port
// Menerima data dari ESP32 melalui serial (misalnya suhu atau status lampu)
parser.on("data", (data) => {
    console.log("Data received from ESP32: ", data);

    // Jika data lampu diterima
    if (data.startsWith("LAMP:")) {
        const lampState = data.split(":")[1].trim().toLowerCase(); // Ambil status lampu dan konversi ke lowercase
        lampuState = lampState === "on" ? "on" : "off"; // Standarisasi status
        console.log("Lampu State Updated:", lampuState);
        io.emit("lampuUpdate", { status: lampuState });
    }

    // Jika data suhu dan kelembaban diterima
    if (data.startsWith("TEMP:")) {
        const tempHumid = data.split(" HUM:");  // Pisahkan suhu dan kelembaban
        if (tempHumid.length === 2) {
            try {
                currentTemperature = parseFloat(tempHumid[0].split(":")[1].trim());  // Ambil suhu
                currentHumidity = parseFloat(tempHumid[1].trim());  // Ambil kelembaban
                console.log("Temperature Updated:", currentTemperature);
                console.log("Humidity Updated:", currentHumidity);

                io.emit("temperatureUpdate", { temperature: currentTemperature, humidity: currentHumidity });
            } catch (error) {
                console.log("Error parsing temperature and humidity data: ", error);
            }
        } else {
            console.log("Data format incorrect for temperature and humidity");
        }
    }
});

// Kirim perintah untuk mendapatkan suhu dan kelembaban setiap 10 detik
setInterval(() => {
    console.log("Sending GET_TEMP command to ESP32");
    port.write("GET_TEMP\n", (err) => {
        if (err) {
            console.log("Error writing to serial port: ", err);
        }
    });
}, 10000); // Setiap 10 detik

// Socket.IO untuk menerima dan mengirim status lampu dan suhu
io.on("connection", (socket) => {
    console.log("Client connected");

    // Kirim update status lampu dan suhu ke client saat terhubung
    socket.emit("lampuUpdate", { status: lampuState });
    socket.emit("temperatureUpdate", { temperature: currentTemperature, humidity: currentHumidity });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

// Jalankan server
const portNumber = 3000;
server.listen(portNumber, () => {
    console.log(`Server running on port ${portNumber}`);
});
