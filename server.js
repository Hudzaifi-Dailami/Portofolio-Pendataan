const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Menyambungkan Frontend HTML agar bisa diakses langsung
app.use(express.static(path.join(__dirname, 'public')));

// Folder penyimpanan foto (Otomatis dibuat jika belum ada)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// 1. KONEKSI & PEMBUATAN DATABASE SQLITE
const db = new sqlite3.Database('./database_rtlh.sqlite', (err) => {
    if (err) console.error(err.message);
    console.log('✅ Database SQLite Siap.');
});

// Pembuatan Tabel Otomatis
db.run(`CREATE TABLE IF NOT EXISTS data_pengajuan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomor_urut TEXT,
    nama TEXT NOT NULL,
    nik TEXT NOT NULL,
    no_kk TEXT NOT NULL,
    alamat TEXT,
    desa TEXT,
    kecamatan TEXT,
    koordinat TEXT,
    keterangan TEXT,
    folder_path TEXT,
    tanggal DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const simpanGambar = (base64Data, namaFile, folderTarget) => {
    if (!base64Data) return;
    const base64Image = base64Data.split(';base64,').pop();
    const filePath = path.join(folderTarget, namaFile);
    fs.writeFileSync(filePath, base64Image, { encoding: 'base64' });
};

// 2. API: SIMPAN / UPDATE DATA
app.post('/api/simpanData', (req, res) => {
    const data = req.body.data;
    const isEdit = data.rowIndex && data.rowIndex > 0;
    
    let nomorUrut = isEdit ? data.nomor_urut_lama || Math.floor(100 + Math.random() * 900).toString() : Math.floor(100 + Math.random() * 900).toString();
    const namaWarga = data.nama.replace(/[^a-zA-Z0-9]/g, '_');
    const folderWarga = path.join(uploadDir, `RTLH_${namaWarga}_${nomorUrut}`);
    if (!fs.existsSync(folderWarga)) fs.mkdirSync(folderWarga);

    simpanGambar(data.fotoKTP?.base64, 'KTP.jpg', folderWarga);
    simpanGambar(data.fotoKK?.base64, 'KK.jpg', folderWarga);
    simpanGambar(data.fotoSuratTanah?.base64, 'SuratTanah.jpg', folderWarga);
    simpanGambar(data.fotoSKTM?.base64, 'SKTM.jpg', folderWarga);
    for (let i = 1; i <= 5; i++) {
        simpanGambar(data[`foto${i}`]?.base64, `FotoRumah_${i}.jpg`, folderWarga);
    }

    if (isEdit) {
        const query = `UPDATE data_pengajuan SET nama=?, nik=?, no_kk=?, alamat=?, desa=?, kecamatan=?, koordinat=?, keterangan=? WHERE id=?`;
        db.run(query, [data.nama, data.nik, data.no_kk, data.alamat, data.desa, data.kecamatan, data.koordinat, data.keterangan, data.rowIndex], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, isEdit: true });
        });
    } else {
        const query = `INSERT INTO data_pengajuan (nomor_urut, nama, nik, no_kk, alamat, desa, kecamatan, koordinat, keterangan, folder_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(query, [nomorUrut, data.nama, data.nik, data.no_kk, data.alamat, data.desa, data.kecamatan, data.koordinat, data.keterangan, folderWarga], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, nomor: nomorUrut, isEdit: false });
        });
    }
});

// 3. API: STATISTIK
app.get('/api/statistik', (req, res) => {
    db.get('SELECT COUNT(*) AS total FROM data_pengajuan', (err, row) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, totalPengajuan: row ? row.total : 0 });
    });
});

// 4. API: GRAFIK DESA
app.get('/api/grafik', (req, res) => {
    db.all('SELECT kecamatan, desa, COUNT(*) as jumlah FROM data_pengajuan GROUP BY kecamatan, desa', (err, rows) => {
        if (err) return res.json({ success: false });
        let rekap = {};
        rows.forEach(row => {
            if (!rekap[row.kecamatan]) rekap[row.kecamatan] = {};
            rekap[row.kecamatan][row.desa] = row.jumlah;
        });
        res.json({ success: true, data: rekap });
    });
});

// 5. API: PETA SPASIAL
app.get('/api/peta', (req, res) => {
    db.all('SELECT nomor_urut, nama, desa, kecamatan, koordinat FROM data_pengajuan', (err, rows) => {
        if (err) return res.json({ success: false });
        const formatPeta = rows.map(row => {
            const coords = (row.koordinat || '').split(',');
            return { nomor: row.nomor_urut, nama: row.nama, desa: row.desa, kecamatan: row.kecamatan, lat: parseFloat(coords[0]), lng: parseFloat(coords[1]) };
        }).filter(item => !isNaN(item.lat) && !isNaN(item.lng));
        res.json({ success: true, data: formatPeta });
    });
});

// 6. API: CEK STATUS
app.post('/api/cekStatus', (req, res) => {
    db.get('SELECT * FROM data_pengajuan WHERE nik = ? ORDER BY id DESC LIMIT 1', [req.body.nik], (err, row) => {
        if (err || !row) return res.json({ found: false });
        const mask = (s) => (s && s.length > 10) ? s.substring(0,6) + '******' + s.substring(s.length-4) : s;
        res.json({ found: true, data: { nomor: row.nomor_urut, nama: row.nama, maskedNik: mask(row.nik), maskedNoKK: mask(row.no_kk), alamat: row.alamat, desa: row.desa, kecamatan: row.kecamatan, tanggal: row.tanggal }});
    });
});

// 7. API: DATA EDIT
app.post('/api/detailEdit', (req, res) => {
    db.get('SELECT * FROM data_pengajuan WHERE nik = ? ORDER BY id DESC LIMIT 1', [req.body.nik], (err, row) => {
        if (err || !row) return res.json({ success: false, message: "Data tidak ditemukan" });
        let existingFiles = {};
        if (row.folder_path && fs.existsSync(row.folder_path)) {
            const files = fs.readdirSync(row.folder_path);
            files.forEach(f => {
                if(f.includes('KTP')) existingFiles['ktp'] = true;
                if(f.includes('KK')) existingFiles['kk'] = true;
                if(f.includes('SuratTanah')) existingFiles['surat_tanah'] = true;
                if(f.includes('SKTM')) existingFiles['sktm'] = true;
                for(let i=1; i<=5; i++) if(f.includes(`FotoRumah_${i}`)) existingFiles[`foto${i}`] = true;
            });
        }
        res.json({ success: true, rowIndex: row.id, data: { nomor: row.nomor_urut, nama: row.nama, nik: row.nik, no_kk: row.no_kk, alamat: row.alamat, desa: row.desa, kecamatan: row.kecamatan, koordinat: row.koordinat, keterangan: row.keterangan, nomor_urut_lama: row.nomor_urut }, existingFiles: existingFiles });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Aplikasi Live di http://localhost:${PORT}`));