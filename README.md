# Moviething

A Node.js backend application for tracking movies you've watched, with integration for OMDB API and Letterboxd export functionality.

## Features

- Track movies you've watched with details like viewing date, format, and location
- Search movies using OMDB API
- Export your watched movies to Letterboxd format
- Check if a movie is a first-time viewing
- API key authentication for secure endpoints

## Prerequisites

- Node.js (v14 or higher)
- MariaDB/MySQL database
- OMDB API key

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your configuration:
   ```bash
   cp .env.example .env
   ```
4. Configure your environment variables in `.env`:
   - `PORT`: The port number for the server (default: 3000)
   - `MOVIETHING_SQL_HOST`: MariaDB host
   - `MOVIETHING_SQL_USER`: MariaDB username
   - `MOVIETHING_SQL_PASS`: MariaDB password
   - `MOVIETHING_SQL_DB`: MariaDB database name
   - `MOVIETHING_OMDB_API_KEY`: Your OMDB API key
   - `MOVIETHING_VALID_API_KEY`: Your chosen API key for authentication

## Database Setup

Ensure you have a MariaDB database with the following table:

```sql
CREATE TABLE movies (
    movieTitle VARCHAR(255),
    viewingDate DATE,
    movieURL VARCHAR(255),
    viewFormat VARCHAR(255),
    viewLocation VARCHAR(255),
    firstViewing TINYINT(1),
    movieGenre VARCHAR(255),
    movieReview TEXT
);
```

## Running the Application

Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

All endpoints that require authentication need an `apiKey` parameter either in the query string or request body.

- `GET /`: Get movies watched in a specific year (defaults to current year)
- `POST /searchMovie`: Search for movies using OMDB API
- `POST /getMovieDetails`: Get detailed movie information from OMDB
- `POST /newEntry`: Add a new movie entry
- `GET /exportLetterboxd`: Export movies in Letterboxd CSV format

## Example API Usage

Search for a movie:
```bash
curl -X POST "http://localhost:3000/searchMovie" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "apiKey=your_api_key" \
  -d "json={\"title\":\"The Matrix\"}"
```

Add a new movie entry:
```bash
curl -X POST "http://localhost:3000/newEntry" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "apiKey=your_api_key" \
  -d "json={\"movieTitle\":\"The Matrix\",\"viewingDate\":\"2024-03-15\",\"movieURL\":\"https://www.imdb.com/title/tt0133093\",\"viewFormat\":\"Digital\",\"viewLocation\":\"Home\",\"movieGenre\":\"Sci-Fi\",\"movieReview\":\"Amazing!\",\"firstViewing\":true}"
``` 