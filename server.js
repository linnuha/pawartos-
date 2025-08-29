const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SECRET_KEY = "rahasia123"; // ganti dengan secret lebih kuat
const PORT = 3000;

// database
const db = new sqlite3.Database('./db.sqlite', (err)=>{
    if(err) console.error(err);
    else console.log("Database ready");
});

// buat table user & penduduk
db.serialize(()=>{
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS penduduk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nik TEXT,
        nama TEXT,
        alamat TEXT,
        nohp TEXT,
        fotoKK TEXT,
        fotoDiri TEXT,
        fotoDepanRumah TEXT,
        lokasi TEXT,
        keterangan TEXT
    )`);

    // buat user admin demo
    const adminPass = bcrypt.hashSync("admin123",10);
    db.run(`INSERT OR IGNORE INTO users(username,password,role) VALUES('admin',?,?)`, [adminPass,'admin']);
    const memberPass = bcrypt.hashSync("member123",10);
    db.run(`INSERT OR IGNORE INTO users(username,password,role) VALUES('member',?,?)`, [memberPass,'member']);
});

// middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
app.use(express.static('public'));

// multer config
const storage = multer.diskStorage({
    destination: (req,file,cb)=>{ cb(null,'uploads/'); },
    filename: (req,file,cb)=>{
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({storage});

// auth middleware
function auth(role=null){
    return function(req,res,next){
        const token = req.headers.authorization?.split(' ')[1];
        if(!token) return res.status(401).json({error:"Unauthorized"});
        try{
            const decoded = jwt.verify(token, SECRET_KEY);
            req.user = decoded;
            if(role && decoded.role!==role) return res.status(403).json({error:"Forbidden"});
            next();
        }catch(e){ res.status(401).json({error:"Invalid token"}); }
    }
}

// login
app.post('/api/login', (req,res)=>{
    const {username,password} = req.body;
    db.get("SELECT * FROM users WHERE username=?", [username], (err,row)=>{
        if(err) return res.status(500).json({error:err.message});
        if(!row) return res.status(400).json({error:"User not found"});
        if(!bcrypt.compareSync(password,row.password)) return res.status(400).json({error:"Wrong password"});
        const token = jwt.sign({id:row.id,username:row.username,role:row.role}, SECRET_KEY);
        res.json({token, role: row.role});
    });
});

// get all penduduk
app.get('/api/penduduk', auth(), (req,res)=>{
    db.all("SELECT * FROM penduduk", [], (err,rows)=>{
        if(err) return res.status(500).json({error:err.message});
        res.json(rows);
    });
});

// add penduduk
app.post('/api/penduduk', auth('admin'), upload.fields([{name:'fotoKK'},{name:'fotoDiri'},{name:'fotoDepanRumah'}]), (req,res)=>{
    const {nik,nama,alamat,nohp,lokasi,keterangan} = req.body;
    const fotoKK = req.files['fotoKK'] ? req.files['fotoKK'][0].filename : '';
    const fotoDiri = req.files['fotoDiri'] ? req.files['fotoDiri'][0].filename : '';
    const fotoDepanRumah = req.files['fotoDepanRumah'] ? req.files['fotoDepanRumah'][0].filename : '';
    db.run(`INSERT INTO penduduk(nik,nama,alamat,nohp,fotoKK,fotoDiri,fotoDepanRumah,lokasi,keterangan) VALUES(?,?,?,?,?,?,?,?,?)`,
        [nik,nama,alamat,nohp,fotoKK,fotoDiri,fotoDepanRumah,lokasi,keterangan],
        function(err){ if(err) return res.status(500).json({error:err.message}); res.json({id:this.lastID}); }
    );
});

// edit penduduk
app.put('/api/penduduk/:id', auth('admin'), upload.fields([{name:'fotoKK'},{name:'fotoDiri'},{name:'fotoDepanRumah'}]), (req,res)=>{
    const {id} = req.params;
    db.get("SELECT * FROM penduduk WHERE id=?", [id], (err,row)=>{
        if(err) return res.status(500).json({error:err.message});
        if(!row) return res.status(404).json({error:"Not found"});
        const {nik,nama,alamat,nohp,lokasi,keterangan} = req.body;
        const fotoKK = req.files['fotoKK'] ? req.files['fotoKK'][0].filename : row.fotoKK;
        const fotoDiri = req.files['fotoDiri'] ? req.files['fotoDiri'][0].filename : row.fotoDiri;
        const fotoDepanRumah = req.files['fotoDepanRumah'] ? req.files['fotoDepanRumah'][0].filename : row.fotoDepanRumah;
        db.run(`UPDATE penduduk SET nik=?,nama=?,alamat=?,nohp=?,fotoKK=?,fotoDiri=?,fotoDepanRumah=?,lokasi=?,keterangan=? WHERE id=?`,
            [nik,nama,alamat,nohp,fotoKK,fotoDiri,fotoDepanRumah,lokasi,keterangan,id],
            err=>{ if(err) return res.status(500).json({error:err.message}); res.json({success:true}); }
        );
    });
});

// delete penduduk
app.delete('/api/penduduk/:id', auth('admin'), (req,res)=>{
    const {id} = req.params;
    db.run("DELETE FROM penduduk WHERE id=?", [id], err=>{
        if(err) return res.status(500).json({error:err.message});
        res.json({success:true});
    });
});

// export Excel
app.get('/api/export', auth('admin'), (req,res)=>{
    db.all("SELECT * FROM penduduk", [], (err,rows)=>{
        if(err) return res.status(500).json({error:err.message});
        const ws_data=[["No","NIK","Nama","Alamat","No HP","Foto KK","Foto Diri","Foto Depan Rumah","Lokasi","Keterangan"]];
        rows.forEach((p,i)=>{
            const fotoKK = p.fotoKK ? fs.readFileSync(`uploads/${p.fotoKK}`, {encoding:'base64'}) : '';
            const fotoDiri = p.fotoDiri ? fs.readFileSync(`uploads/${p.fotoDiri}`, {encoding:'base64'}) : '';
            const fotoDepan = p.fotoDepanRumah ? fs.readFileSync(`uploads/${p.fotoDepanRumah}`, {encoding:'base64'}) : '';
            ws_data.push([i+1,p.nik,p.nama,p.alamat,p.nohp,fotoKK,fotoDiri,fotoDepan,p.lokasi,p.keterangan]);
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        XLSX.utils.book_append_sheet(wb, ws, "Penduduk");
        const filePath = 'uploads/data_penduduk.xlsx';
        XLSX.writeFile(wb, filePath);
        res.download(filePath);
    });
});

app.listen(PORT, ()=>console.log(`Server running on http://localhost:${PORT}`));
