const express = require('express');
const app = express();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
app.set('view engine', 'ejs');

app.use(session({
    secret: 'rahasia-super-negara',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// --- ROUTES UMUM ---
app.get('/', async (req, res) => {
    const { search } = req.query;
    let books;
    if (search) {
        books = await prisma.book.findMany({
            where: {
                OR: [
                    { title: { contains: search } },
                    { author: { contains: search } },
                    { moodTags: { contains: search } }
                ]
            },
            orderBy: { createdAt: 'desc' }
        });
    } else {
        books = await prisma.book.findMany({ orderBy: { createdAt: 'desc' } });
    }
    res.render('index', { books, user: req.session.user || null, searchQuery: search || '' });
});

app.get('/tv', async (req, res) => {
    try {
        const topUsers = await prisma.user.findMany({ where: { role: 'member' }, orderBy: { xpPoints: 'desc' }, take: 5 });
        const newBooks = await prisma.book.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
        const totalReads = await prisma.loan.count({ where: { status: 'returned' } });
        res.render('tv', { topUsers, newBooks, totalReads });
    } catch (error) { res.send("Gagal memuat TV Mode"); }
});

app.get('/book/:id', async (req, res) => {
    const bookId = parseInt(req.params.id);
    try {
        const book = await prisma.book.findUnique({
            where: { id: bookId },
            include: { reviews: { include: { user: true }, orderBy: { createdAt: 'desc' } } }
        });
        let avgRating = 0;
        if (book.reviews.length > 0) {
            const total = book.reviews.reduce((sum, review) => sum + review.rating, 0);
            avgRating = (total / book.reviews.length).toFixed(1);
        }
        const stock = await prisma.bookCopy.count({ where: { bookId: bookId, isAvailable: true } });
        res.render('detail', { book, stock, avgRating, user: req.session.user || null });
    } catch (error) { res.send("Buku hilang."); }
});

app.post('/book/:id/review', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const bookId = parseInt(req.params.id);
    const { rating, comment } = req.body;
    try {
        await prisma.review.create({ data: { rating: parseInt(rating), comment, bookId, userId: req.session.user.id } });
        res.redirect(`/book/${bookId}`);
    } catch (error) { res.send("Gagal kirim review."); }
});

app.post('/book/:id/borrow', async (req, res) => {
    if (!req.session.user) return res.send("Login Dulu!");
    const bookId = parseInt(req.params.id);
    const userId = req.session.user.id;
    try {
        const availableCopy = await prisma.bookCopy.findFirst({ where: { bookId: bookId, isAvailable: true } });
        if (!availableCopy) return res.send("Stok habis.");
        await prisma.$transaction([
            prisma.loan.create({ data: { userId, copyId: availableCopy.id, dueDate: new Date(new Date().setDate(new Date().getDate() + 7)), status: 'active' } }),
            prisma.bookCopy.update({ where: { id: availableCopy.id }, data: { isAvailable: false } })
        ]);
        res.redirect('/profile');
    } catch (error) { res.send("Gagal pinjam."); }
});

// --- ADMIN DASHBOARD (UPDATE STOK) ---
app.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.send("Akses Ditolak");
    
    const countBooks = await prisma.book.count();
    const countUsers = await prisma.user.count({ where: { role: 'member' } });
    const countLoans = await prisma.loan.count({ where: { status: 'active' } });
    
    const activeLoans = await prisma.loan.findMany({ 
        where: { status: 'active' }, 
        include: { user: true, bookCopy: { include: { book: true } } }, 
        orderBy: { dueDate: 'asc' } 
    });
    
    // UPDATE: Ambil buku beserta jumlah copy-nya
    const allBooks = await prisma.book.findMany({ 
        orderBy: { title: 'asc' },
        include: {
            copies: {
                where: { isAvailable: true } // Cuma hitung yang tersedia
            }
        }
    });

    const allUsers = await prisma.user.findMany({ where: { role: 'member' }, orderBy: { username: 'asc' } });
    
    res.render('admin', { countBooks, countUsers, countLoans, activeLoans, allBooks, allUsers });
});

// ROUTE: TAMBAH STOK (+1)
app.post('/book/:id/add-copy', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Bukan Admin.");
    const bookId = parseInt(req.params.id);
    try {
        await prisma.bookCopy.create({
            data: { bookId: bookId, condition: 'New', shelfLocation: 'Gudang' }
        });
        res.redirect('/admin');
    } catch (e) { res.send("Gagal nambah stok."); }
});

// ROUTE: KURANG STOK (-1)
app.post('/book/:id/remove-copy', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Bukan Admin.");
    const bookId = parseInt(req.params.id);
    try {
        // Cari 1 buku yang available buat dihapus
        const copy = await prisma.bookCopy.findFirst({ where: { bookId: bookId, isAvailable: true } });
        if (copy) {
            await prisma.bookCopy.delete({ where: { id: copy.id } });
        }
        res.redirect('/admin');
    } catch (e) { res.send("Gagal kurang stok."); }
});

app.post('/book/:id/delete', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Bukan Admin.");
    const bookId = parseInt(req.params.id);
    try {
        await prisma.$transaction([
            prisma.loan.deleteMany({ where: { bookCopy: { bookId: bookId } } }),
            prisma.review.deleteMany({ where: { bookId: bookId } }),
            prisma.readingJourney.deleteMany({ where: { bookId: bookId } }),
            prisma.bookCopy.deleteMany({ where: { bookId: bookId } }),
            prisma.book.delete({ where: { id: bookId } })
        ]);
        res.redirect('/admin');
    } catch (error) { res.send("Gagal hapus buku."); }
});

app.post('/user/:id/delete', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Bukan Admin.");
    const userId = parseInt(req.params.id);
    try {
        await prisma.$transaction([
            prisma.loan.deleteMany({ where: { userId: userId } }),
            prisma.review.deleteMany({ where: { userId: userId } }),
            prisma.readingJourney.deleteMany({ where: { userId: userId } }),
            prisma.user.delete({ where: { id: userId } })
        ]);
        res.redirect('/admin');
    } catch (error) { res.send("Gagal hapus user."); }
});

// --- HALAMAN LAINNYA ---
app.get('/add-book', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.send("Akses Ditolak.");
    res.render('add-book');
});

app.post('/add-book', upload.single('coverImage'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send("Bukan Admin.");
    const { title, author, synopsis, pageCount, moodTags } = req.body;
    const coverImage = req.file ? '/uploads/' + req.file.filename : null;
    await prisma.book.create({ data: { title, author, synopsis, pageCount: parseInt(pageCount), moodTags, coverImage, copies: { create: { condition: 'New', shelfLocation: 'Rak Baru' } } } });
    res.redirect('/');
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const fullUser = await prisma.user.findUnique({
            where: { id: req.session.user.id },
            include: { loans: { include: { bookCopy: { include: { book: true } } }, orderBy: { borrowDate: 'desc' } } }
        });
        const qrData = `MEMBER-${fullUser.id}-${fullUser.username}`;
        const qrImage = await QRCode.toDataURL(qrData);
        res.render('profile', { user: fullUser, loans: fullUser.loans, qrImage });
    } catch (error) { res.send("Error profil."); }
});

app.post('/return/:loanId', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const loanId = parseInt(req.params.loanId);
    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan || loan.status !== 'active') return res.send("Data error.");
    await prisma.$transaction([
        prisma.loan.update({ where: { id: loanId }, data: { status: 'returned', returnDate: new Date() } }),
        prisma.bookCopy.update({ where: { id: loan.copyId }, data: { isAvailable: true } }),
        prisma.user.update({ where: { id: req.session.user.id }, data: { xpPoints: { increment: 50 } } })
    ]);
    res.redirect('/profile');
});

// --- AUTH ---
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { username, email, password: hashedPassword } });
    res.redirect('/login');
});
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password)) return res.render('login', { error: "Salah email/password" });
    req.session.user = user;
    res.redirect('/');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

module.exports = app;
if (require.main === module) {
    app.listen(3000, () => console.log('Server jalan di port 3000 🚀'));
}