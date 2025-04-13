const { getRowsBetweenDates, checkExistingInfo } = require('../src/app');
const mariadb = require('mariadb');

describe('Helper Functions', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mariadb.createPool().getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkExistingInfo', () => {
    it('should check for existing movie information', async () => {
      const mockMovie = {
        movieTitle: 'Test Movie',
        movieGenre: 'Action',
        viewingDate: new Date('2024-01-01'),
        viewFormat: 'Digital',
        viewLocation: 'Home',
        movieReview: 'Great movie!'
      };

      mockConnection.query.mockResolvedValueOnce([mockMovie]);

      const result = await checkExistingInfo('tt1234567');

      expect(result).toHaveLength(1);
      expect(result[0].firstViewing).toBe(false);
      expect(result[0].movieTitle).toBe('Test Movie');
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['%tt1234567%']
      );
    });

    it('should handle empty results', async () => {
      mockConnection.query.mockResolvedValueOnce([]);

      const result = await checkExistingInfo('tt1234567');

      expect(result).toHaveLength(0);
    });
  });

  describe('getRowsBetweenDates', () => {
    it('should fetch movies between dates', async () => {
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

      const result = await getRowsBetweenDates('2024-01-01', '2024-12-31');

      expect(result).toEqual(mockMovies);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['2024-01-01', '2024-12-31']
      );
    });
  });
}); 