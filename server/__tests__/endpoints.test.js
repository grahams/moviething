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
    it('should search for movies without requiring auth', async () => {
      const mockTmdbResponse = { 
        results: [{ 
          id: 123, 
          title: 'Test Movie', 
          release_date: '2024-01-01',
          poster_path: '/test.jpg',
          overview: 'Test overview',
          video: false
        }],
        total_results: 1,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test' }),
        })
        .expect(200);
    });

    it('should filter out videos when exclude_videos is true', async () => {
      const mockTmdbResponse = { 
        results: [
          { 
            id: 123, 
            title: 'Test Movie', 
            release_date: '2024-01-01',
            poster_path: '/test.jpg',
            overview: 'Test overview',
            video: false
          },
          { 
            id: 124, 
            title: 'Test Video', 
            release_date: '2024-01-01',
            poster_path: '/test2.jpg',
            overview: 'Test video overview',
            video: true
          }
        ],
        total_results: 2,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      const response = await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test', exclude_videos: true }),
        })
        .expect(200);


      // Should only return the movie, not the video
      expect(response.body.Search).toHaveLength(1);
      expect(response.body.Search[0].video).toBe(false);
    });

    it('should filter by popularity range', async () => {
      const mockTmdbResponse = { 
        results: [
          { 
            id: 123, 
            title: 'Popular Movie', 
            release_date: '2024-01-01',
            poster_path: '/test.jpg',
            overview: 'Test overview',
            video: false,
            popularity: 100
          },
          { 
            id: 124, 
            title: 'Less Popular Movie', 
            release_date: '2024-01-01',
            poster_path: '/test2.jpg',
            overview: 'Test overview',
            video: false,
            popularity: 50
          }
        ],
        total_results: 2,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      const response = await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test', min_popularity: 75 }),
        })
        .expect(200);

      // Should only return the popular movie
      expect(response.body.Search).toHaveLength(1);
      expect(response.body.Search[0].popularity).toBe(100);
    });

    it('should filter by vote average range', async () => {
      const mockTmdbResponse = { 
        results: [
          { 
            id: 123, 
            title: 'High Rated Movie', 
            release_date: '2024-01-01',
            poster_path: '/test.jpg',
            overview: 'Test overview',
            video: false,
            vote_average: 8.5,
            vote_count: 1000
          },
          { 
            id: 124, 
            title: 'Low Rated Movie', 
            release_date: '2024-01-01',
            poster_path: '/test2.jpg',
            overview: 'Test overview',
            video: false,
            vote_average: 5.2,
            vote_count: 500
          }
        ],
        total_results: 2,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      const response = await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test', min_vote_average: 7.0 }),
        })
        .expect(200);

      // Should only return the high rated movie
      expect(response.body.Search).toHaveLength(1);
      expect(response.body.Search[0].vote_average).toBe(8.5);
    });

    it('should filter by release date range', async () => {
      const mockTmdbResponse = { 
        results: [
          { 
            id: 123, 
            title: 'Recent Movie', 
            release_date: '2023-12-01',
            poster_path: '/test.jpg',
            overview: 'Test overview',
            video: false
          },
          { 
            id: 124, 
            title: 'Old Movie', 
            release_date: '2020-01-01',
            poster_path: '/test2.jpg',
            overview: 'Test overview',
            video: false
          }
        ],
        total_results: 2,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      const response = await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ title: 'Test', min_release_date: '2023-01-01' }),
        })
        .expect(200);

      // Should only return the recent movie
      expect(response.body.Search).toHaveLength(1);
      expect(response.body.Search[0].release_date).toBe('2023-12-01');
    });

    it('should apply multiple filters simultaneously', async () => {
      const mockTmdbResponse = { 
        results: [
          { 
            id: 123, 
            title: 'Good Movie', 
            release_date: '2023-12-01',
            poster_path: '/test.jpg',
            overview: 'Test overview',
            video: false,
            popularity: 100,
            vote_average: 8.5,
            vote_count: 1000
          },
          { 
            id: 124, 
            title: 'Bad Movie', 
            release_date: '2023-06-01',
            poster_path: '/test2.jpg',
            overview: 'Test overview',
            video: false,
            popularity: 50,
            vote_average: 5.2,
            vote_count: 500
          }
        ],
        total_results: 2,
        total_pages: 1
      };
      
      // Set up the fetch mock for this test
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTmdbResponse)
      });

      const response = await request(app)
        .post('/api/searchMovie')
        .send({ 
          json: JSON.stringify({ 
            title: 'Test', 
            min_popularity: 75,
            min_vote_average: 7.0,
            min_release_date: '2023-07-01'
          }),
        })
        .expect(200);

      // Should only return the movie that meets all criteria
      expect(response.body.Search).toHaveLength(1);
      expect(response.body.Search[0].Title).toBe('Good Movie');
    });
  });

  describe('POST /api/newEntry', () => {
    const validEntry = {
      movieTitle: 'Test Movie',
      viewingDate: '01/01/2024',
      movieURL: 'https://www.imdb.com/title/tt1234567/',
      viewFormat: 'Digital',
      viewLocation: 'Home',
      movieGenre: 'Action',
      movieReview: 'Great movie!',
      firstViewing: true
    };

    it('should accept a request with a valid X-Authentik-Username header and no API key', async () => {
      mockConnection.query.mockResolvedValueOnce({ affectedRows: 1 });

      await request(app)
        .post('/api/newEntry')
        .set('X-Authentik-Username', 'testuser')
        .send({ json: JSON.stringify(validEntry) })
        .expect(200);
    });

    it('should accept a request with a valid API key and no X-Authentik-Username header', async () => {
      mockConnection.query.mockResolvedValueOnce({ affectedRows: 1 });

      await request(app)
        .post('/api/newEntry')
        .send({
          apiKey: process.env.MOVIETHING_VALID_API_KEY,
          json: JSON.stringify(validEntry)
        })
        .expect(200);
    });

    it('should reject a request with neither header nor API key', async () => {
      await request(app)
        .post('/api/newEntry')
        .send({ json: JSON.stringify(validEntry) })
        .expect(401);
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