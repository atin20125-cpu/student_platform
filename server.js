const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const masterConfigPath = path.join(__dirname, 'master_config.json');
function getMasterConfig() {
    if (!fs.existsSync(masterConfigPath)) {
        fs.writeFileSync(masterConfigPath, JSON.stringify({ 
            phone: '01041510639', 
            pass: 'Mr Englishiano111', 
            platform_name: 'منصة Mr Englishiano التعليمية' 
        }));
    }
    return JSON.parse(fs.readFileSync(masterConfigPath, 'utf8'));
}

const dbPath = path.join(__dirname, 'students_db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS students (
            card_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            grade TEXT,
            parent_phone TEXT,
            days TEXT,
            attendance INTEGER DEFAULT 0,
            paid INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS student_quizzes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER,
            score TEXT,
            quiz_date TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_name TEXT,
            grade TEXT,
            max_score INTEGER
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS student_exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER,
            exam_id INTEGER,
            score INTEGER
        )`);
    }
});

app.get('/api/platform/config', (req, res) => {
    const config = getMasterConfig();
    res.json({ platform_name: config.platform_name });
});

app.post('/api/master/login', (req, res) => {
    const { phone, pass } = req.body;
    const config = getMasterConfig();
    if (phone === config.phone && pass === config.pass) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }
});

app.post('/api/master/update', (req, res) => {
    const { old_phone, old_pass, new_phone, new_pass, platform_name } = req.body;
    const config = getMasterConfig();

    if (old_phone !== config.phone || old_pass !== config.pass) {
        return res.status(401).json({ error: 'رقم الهاتف القديم أو كلمة المرور القديمة غير صحيحة' });
    }

    if (!new_phone || !new_pass || !platform_name) {
        return res.status(400).json({ error: 'برجاء إدخال البيانات كاملة' });
    }
    
    fs.writeFileSync(masterConfigPath, JSON.stringify({ 
        phone: new_phone, 
        pass: new_pass, 
        platform_name: platform_name 
    }));
    res.json({ message: 'Success' });
});

app.post('/api/master/reset-students', (req, res) => {
    const { phone, pass } = req.body;
    const config = getMasterConfig();

    if (phone !== config.phone || pass !== config.pass) {
        return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }

    db.serialize(() => {
        db.run(`DELETE FROM students`);
        db.run(`DELETE FROM student_quizzes`);
        db.run(`DELETE FROM exams`);
        db.run(`DELETE FROM student_exams`, (err) => {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ أثناء مسح البيانات' });
            }
            res.json({ message: 'Success' });
        });
    });
});

function getMissingQuizDates(studentDaysStr, existingQuizzes) {
    if (!studentDaysStr) return [];
    
    const dayMap = {
        'الأحد': 0, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3,
        'الخميس': 4, 'الجمعة': 5, 'السبت': 6
    };

    const targetDays = studentDaysStr.split('،').map(d => d.trim()).map(d => dayMap[d]).filter(d => d !== undefined);
    let missingQuizzes = [];
    
    let startDate = new Date(2026, 7, 1);
    let today = new Date();
    today.setHours(0, 0, 0, 0);

    let curr = new Date(startDate);
    while (curr <= today) {
        let dayOfWeek = curr.getDay();
        if (targetDays.includes(dayOfWeek)) {
            let formattedDate = curr.toLocaleDateString('ar-EG');
            let foundQuiz = existingQuizzes.find(q => q.quiz_date === formattedDate);
            
            if (!foundQuiz) {
                missingQuizzes.push({
                    id: null,
                    quiz_date: formattedDate,
                    score: 'غياب ❌ (0)'
                });
            }
        }
        curr.setDate(curr.getDate() + 1);
    }
    return missingQuizzes;
}

app.post('/api/students/register', (req, res) => {
    const { name, grade, parent_phone, days } = req.body;
    db.run(`INSERT INTO students (name, grade, parent_phone, days) VALUES (?, ?, ?, ?)`, 
    [name, grade, parent_phone, days], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: 'Success', card_id: this.lastID });
    });
});

app.get('/api/students/grade/:grade', (req, res) => {
    db.all(`SELECT * FROM students WHERE grade = ?`, [req.params.grade], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/students/quiz', (req, res) => {
    const { card_id, score } = req.body;
    const currentDate = new Date().toLocaleDateString('ar-EG');
    
    db.run(`UPDATE students SET attendance = 1 WHERE card_id = ?`, [card_id]);
    db.run(`INSERT INTO student_quizzes (card_id, score, quiz_date) VALUES (?, ?, ?)`, [card_id, score, currentDate], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Success' });
    });
});

app.post('/api/students/update-quiz', (req, res) => {
    const { quiz_id, score } = req.body;
    db.run(`UPDATE student_quizzes SET score = ? WHERE id = ?`, [score, quiz_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Success' });
    });
});

app.post('/api/students/add-quiz-date', (req, res) => {
    const { card_id, quiz_date, score } = req.body;
    db.run(`INSERT INTO student_quizzes (card_id, score, quiz_date) VALUES (?, ?, ?)`, [card_id, quiz_date, score], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Success' });
    });
});

app.post('/api/students/attendance', (req, res) => {
    const { card_id } = req.body;
    db.run(`UPDATE students SET attendance = 1 WHERE card_id = ?`, [card_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'رقم الطالب غير موجود' });
        res.json({ message: 'Success' });
    });
});

app.post('/api/students/payment', (req, res) => {
    const { card_id } = req.body;
    db.run(`UPDATE students SET paid = 1 WHERE card_id = ?`, [card_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'رقم الطالب غير موجود' });
        res.json({ message: 'Success' });
    });
});

app.post('/api/exams/create', (req, res) => {
    const { exam_name, grade, max_score } = req.body;
    db.run(`INSERT INTO exams (exam_name, grade, max_score) VALUES (?, ?, ?)`, [exam_name, grade, max_score], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Success', exam_id: this.lastID });
    });
});

app.get('/api/exams/grade/:grade', (req, res) => {
    db.all(`SELECT * FROM exams WHERE grade = ?`, [req.params.grade], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/exams/score', (req, res) => {
    const { card_id, exam_id, score } = req.body;
    db.run(`INSERT INTO student_exams (card_id, exam_id, score) VALUES (?, ?, ?)`, [card_id, exam_id, score], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Success' });
    });
});

app.get('/api/students/search/:query', (req, res) => {
    let query = req.params.query;
    let sql = isNaN(query) ? `SELECT * FROM students WHERE name LIKE ?` : `SELECT * FROM students WHERE card_id = ?`;
    let params = isNaN(query) ? [`%${query}%`] : [query];

    db.all(sql, params, (err, students) => {
        if (err || !students || students.length === 0) return res.status(404).json({ error: 'الطالب غير موجود' });
        
        let student = students[0];
        db.all(`SELECT * FROM student_quizzes WHERE card_id = ? ORDER BY id DESC`, [student.card_id], (err, quizzes) => {
            let realQuizzes = quizzes || [];
            let missing = getMissingQuizDates(student.days, realQuizzes);
            
            student.quizzes = [...realQuizzes, ...missing];
            
            db.all(`SELECT exams.exam_name, student_exams.score, exams.max_score 
                    FROM student_exams 
                    JOIN exams ON student_exams.exam_id = exams.id 
                    WHERE student_exams.card_id = ?`, [student.card_id], (err, exams) => {
                student.exam_records = exams || [];
                res.json(student);
            });
        });
    });
});

app.post('/api/parent/login', (req, res) => {
    const { parent_phone, card_id } = req.body;
    db.get(`SELECT * FROM students WHERE card_id = ? AND parent_phone = ?`, [card_id, parent_phone], (err, student) => {
        if (err || !student) return res.status(404).json({ error: 'بيانات غير صحيحة أو الطالب غير موجود' });

        db.all(`SELECT * FROM student_quizzes WHERE card_id = ? ORDER BY id DESC`, [student.card_id], (err, quizzes) => {
            let realQuizzes = quizzes || [];
            let missing = getMissingQuizDates(student.days, realQuizzes);

            student.quizzes = [...realQuizzes, ...missing];

            db.all(`SELECT exams.exam_name, student_exams.score, exams.max_score 
                    FROM student_exams 
                    JOIN exams ON student_exams.exam_id = exams.id 
                    WHERE student_exams.card_id = ?`, [student.card_id], (err, exams) => {
                student.exam_records = exams || [];
                res.json(student);
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});