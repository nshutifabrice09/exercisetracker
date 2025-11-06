const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DATABASE_USER,
  host: process.env.DATABASE_HOST,
  database: process.env.DATABASE_NAME,
  password: process.env.DATABASE_PASSWORD,
  port: process.env.DATABASE_PORT,
});

client.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Database connection error:', err.stack));

// Users table - matching UserSchema
const createUsersTable = `
  CREATE TABLE IF NOT EXISTS users (
    _id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL
  )
`;

// Exercises table - matching ExerciseSchema
const createExercisesTable = `
  CREATE TABLE IF NOT EXISTS exercises (
    _id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    duration INTEGER NOT NULL,
    date DATE NOT NULL
  )
`;

// Execute queries sequentially
const initDatabase = async () => {
  try {
    await client.query(createUsersTable);
    console.log('Users table created or already exists');
    
    await client.query(createExercisesTable);
    console.log('Exercises table created or already exists');
  } catch (err) {
    console.error('Error creating tables:', err);
  }
};
  
initDatabase();

// Helper function to generate MongoDB-like ObjectId
function generateObjectId() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const randomValue = Math.random().toString(16).substr(2, 16);
  return (timestamp + randomValue).substr(0, 24);
}


app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});


// Create a new user
app.post("/api/users", async (req, res) => {
  const username = req.body.username;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Check if username already exists
    const existingUser = await client.query(
      'SELECT username, _id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.json({
        username: existingUser.rows[0].username,
        _id: existingUser.rows[0]._id
      });
    }

    // Generate MongoDB-like ObjectId
    const userId = generateObjectId();

    // Insert new user
    const result = await client.query(
      'INSERT INTO users (_id, username) VALUES ($1, $2) RETURNING username, _id',
      [userId, username]
    );
    
    const user = result.rows[0];
    res.json({
      username: user.username,
      _id: user._id
    });
  } catch(err) {
    console.error('Error creating user:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
app.get("/api/users", async (req, res) => {
  try {
    const result = await client.query('SELECT username, _id FROM users ORDER BY username');
    res.json(result.rows);
  } catch(err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add exercise for a user
app.post("/api/users/:_id/exercises", async (req, res) => {
  const userId = req.params._id;
  const { description, duration, date } = req.body;

  if (!description || !duration) {
    return res.status(400).json({ error: 'Description and duration are required' });
  }
  
  const exerciseDate = date ? new Date(date) : new Date();

  try {
    const userResult = await client.query('SELECT * FROM users WHERE _id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate exercise ID
    const exerciseId = generateObjectId();

    const exerciseResult = await client.query(
      'INSERT INTO exercises (_id, user_id, description, duration, date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [exerciseId, userId, description, parseInt(duration), exerciseDate]
    );

    const exercise = exerciseResult.rows[0];
    const user = userResult.rows[0];

    res.json({
      _id: user._id,
      username: user.username,
      date: new Date(exercise.date).toDateString(),
      duration: exercise.duration,
      description: exercise.description
    });
  } catch(err) {
    console.error('Error adding exercise:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's exercise log - FIXED for test 11
app.get("/api/users/:_id/logs", async (req, res) => {
  const userId = req.params._id;
  const { from, to, limit } = req.query;

  try {
    const userResult = await client.query('SELECT _id, username FROM users WHERE _id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    let query = 'SELECT description, duration, date FROM exercises WHERE user_id = $1';
    const params = [userId];
    let paramIndex = 2;

    if (from) {
      query += ` AND date >= $${paramIndex}`;
      params.push(new Date(from));
      paramIndex++;
    }

    if (to) {
      query += ` AND date <= $${paramIndex}`;
      params.push(new Date(to));
      paramIndex++;
    }

    query += ' ORDER BY date';

    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
    }

    const exercisesResult = await client.query(query, params);

    const log = exercisesResult.rows.map(exercise => ({
      description: exercise.description,
      duration: exercise.duration,
      date: new Date(exercise.date).toDateString()
    }));

    // Return with _id and username first, then count and log
    res.json({
      _id: user._id,
      username: user.username,
      count: log.length,
      log: log
    });
  } catch(err) {
    console.error('Error fetching logs:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Optional: Reset database endpoint for testing
app.get("/api/reset", async (req, res) => {
  try {
    await client.query('DROP TABLE IF EXISTS exercises CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    await initDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch(err) {
    console.error('Error resetting database:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});