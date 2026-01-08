const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Mulai menanam data dummy...')

  // --- TAHAP 1: BIKIN BUKU DULU (Supaya ID-nya ada) ---
  
  const harryPotter = await prisma.book.create({
    data: {
      title: 'Harry Potter dan Batu Bertuah',
      author: 'J.K. Rowling',
      isbn: '978-602-03-1234-5',
      synopsis: 'Seorang anak yatim piatu yang ternyata penyihir...',
      pageCount: 300,
      moodTags: 'Fantasi, Sihir, Petualangan, Nostalgia',
      copies: {
        create: [
            { condition: 'New', shelfLocation: 'Rak A-1' },
            { condition: 'Good', shelfLocation: 'Rak A-1' }
        ]
      }
    },
  })

  const atomicHabits = await prisma.book.create({
    data: {
      title: 'Atomic Habits',
      author: 'James Clear',
      isbn: '978-602-06-3317-6',
      synopsis: 'Perubahan kecil yang memberikan hasil luar biasa...',
      pageCount: 350,
      moodTags: 'Pengembangan Diri, Produktivitas, Motivasi',
      copies: {
        create: { condition: 'New', shelfLocation: 'Rak B-3' }
      }
    },
  })

  // --- TAHAP 2: BIKIN USER (Sekarang aman karena buku sudah ada) ---

  const siswa = await prisma.user.upsert({
    where: { email: 'siswa@sekolah.id' },
    update: {},
    create: {
      username: 'SiKutuBuku',
      email: 'siswa@sekolah.id',
      password: 'rahasia_negara', 
      role: 'member',
      xpPoints: 150,
      level: 2,
      currentStreak: 5,
      // Hubungkan ke buku Harry Potter yang BARU SAJA dibuat di atas
      readingJourney: {
        create: {
            status: 'Reading',
            bookId: harryPotter.id, // Ambil ID asli dari buku di atas
            currentPage: 45
        }
      }
    },
  })

  // --- TAHAP 3: BIKIN PEMINJAMAN ---

  // Ambil salah satu copy fisik Harry Potter
  const copyBukuHP = await prisma.bookCopy.findFirst({
    where: { bookId: harryPotter.id }
  });

  if (copyBukuHP) {
    await prisma.loan.create({
        data: {
        userId: siswa.id,
        copyId: copyBukuHP.id,
        dueDate: new Date(new Date().setDate(new Date().getDate() + 7)), 
        status: 'active'
        }
    })
  }

  console.log('✅ Selesai! Urutan sudah benar & Data masuk.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })