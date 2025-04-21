const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create SQLite database connection
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Drop existing table if it exists
        db.run(`DROP TABLE IF EXISTS posts`, (err) => {
            if (err) {
                console.error('Error dropping table:', err);
            } else {
                // Create posts table with image_path column
                db.run(`CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    image_path TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (err) => {
                    if (err) {
                        console.error('Error creating table:', err);
                    } else {
                        console.log('Posts table created successfully');
                    }
                });
            }
        });
    }
});

// Get all posts
app.get('/posts', (req, res) => {
    db.all('SELECT * FROM posts ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Get a single post
app.get('/posts/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM posts WHERE id = ?', [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        res.json(row);
    });
});

// Create a new post with image
app.post('/posts', upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!title || !content) {
        res.status(400).json({ error: 'Title and content are required' });
        return;
    }

    db.run('INSERT INTO posts (title, content, image_path) VALUES (?, ?, ?)', 
        [title, content, imagePath], 
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.status(201).json({
                id: this.lastID,
                title,
                content,
                image_path: imagePath,
                created_at: new Date().toISOString()
            });
        }
    );
});

// Update a post with image
app.put('/posts/:id', upload.single('image'), (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!title || !content) {
        res.status(400).json({ error: 'Title and content are required' });
        return;
    }

    // First get the current post to check if there's an existing image
    db.get('SELECT image_path FROM posts WHERE id = ?', [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        // If there's a new image, delete the old one
        if (imagePath && row.image_path) {
            const oldImagePath = path.join(__dirname, row.image_path);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }

        // Update the post
        const updateQuery = imagePath 
            ? 'UPDATE posts SET title = ?, content = ?, image_path = ? WHERE id = ?'
            : 'UPDATE posts SET title = ?, content = ? WHERE id = ?';
        const params = imagePath 
            ? [title, content, imagePath, id]
            : [title, content, id];

        db.run(updateQuery, params, function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ 
                id, 
                title, 
                content, 
                image_path: imagePath || row.image_path 
            });
        });
    });
});

// Delete a post
app.delete('/posts/:id', (req, res) => {
    const { id } = req.params;
    
    // First get the post to check if there's an image to delete
    db.get('SELECT image_path FROM posts WHERE id = ?', [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        // If there's an image, delete it
        if (row.image_path) {
            const imagePath = path.join(__dirname, row.image_path);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        // Delete the post
        db.run('DELETE FROM posts WHERE id = ?', [id], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.status(204).send();
        });
    });
});

// Close database connection when the server is shut down
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
