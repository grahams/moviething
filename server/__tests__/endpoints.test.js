const request = require('supertest');
const { app } = require('../index');
const mariadb = require('mariadb');

describe('Movie API Endpoints', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
    };
    global.mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/', () => {
    it('should return movies for the current year', async () => {
      const mockMovies = [
        {
          movieTitle: 'Test Movie',
          viewingDate: new Date('2024-01-01'),
          movieURL: 'https://www.imdb.com/title/tt1234567/',
          viewFormat: 'Digital',
          viewLocation: 'Home',
          firstViewing: 1,
          movieGenre: 'Action',
          movieReview: 'Great movie!'
        }
      ];

      // Mock the database query to return our test data
      mockConnection.query.mockResolvedValueOnce(mockMovies);

      const response = await request(app)
        .get('/api/')
        .expect(200);  // Using supertest's expect

      expect(response.body).toHaveLength(1);
      expect(response.body[0].movieTitle).toBe('Test Movie');
      expect(mockConnection.query).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      mockConnection.query.mockRejectedValueOnce(new Error('Database error'));
      
      await request(app)
        .get('/api/')
        .expect(500);
    });
  });

  describe('POST /api/searchMovie', () => {
    it('should require API key', async () => {
      await request(app)
        .post('/api/searchMovie')
        .send({ json: JSON.stringify({ title: 'Test' }) })
        .expect(401);
    });

    it('should search for movies with valid API key', async () => {
      const mockOmdbResponse = { Search: [{ Title: 'Test Movie', Year: '2024' }] };
      global.fetch = jest.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockOmdbResponse)
        })
      );

      await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test' }),
          apiKey: process.env.MOVIETHING_VALID_API_KEY
        })
        .expect(200);
    });
  });

  describe('GET /api/exportLetterboxd', () => {
    it('should export CSV data', async () => {
      const mockMovies = [
        {
          movieTitle: 'Test Movie',
          viewingDate: new Date('2024-01-01'),
          movieURL: 'https://www.imdb.com/title/tt1234567/',
          viewFormat: 'Digital',
          viewLocation: 'Home',
          firstViewing: 1,
          movieGenre: 'Action',
          movieReview: 'Great movie!'
        }
      ];

      mockConnection.query.mockResolvedValueOnce(mockMovies);

      const response = await request(app)
        .get('/api/exportLetterboxd')
        .expect(200)
        .expect('Content-Type', /text\/csv/)
        .expect('Content-Disposition', 'attachment; filename=letterboxd.csv');

      // Additional CSV content checks could go here
    });
  });

  describe('GET /api/health', () => {
    it('should return healthy status in test environment', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: 'test',
        database: {
          status: 'test_mode',
          message: 'Database check skipped in test environment'
        }
      });
    });
  });
}); 