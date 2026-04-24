'use strict';

const request = require('supertest');
const { app } = require('../index');

describe('POST /api/newEntries', () => {
  let mockConnection;

  const validEntry = {
    movieTitle: 'Test Short',
    viewingDate: '04/24/2026',
    movieURL: 'https://iffboston.org/events/test-short/',
    viewFormat: 'IFFBoston',
    viewLocation: 'Somerville Theatre',
    movieGenre: 'Short',
    movieReview: 'Lovely little film',
    firstViewing: true
  };

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    global.mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should insert multiple entries in a transaction', async () => {
    mockConnection.query.mockResolvedValue({ affectedRows: 1 });

    const response = await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry, { ...validEntry, movieTitle: 'Another Short' }] }) })
      .expect(200);

    expect(response.body).toEqual({ data: { ok: true, count: 2 } });
    expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    expect(mockConnection.query).toHaveBeenCalledTimes(2);
  });

  it('should reject with 401 without auth', async () => {
    await request(app)
      .post('/api/newEntries')
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(401);
  });

  it('should reject with 400 for empty entries array', async () => {
    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [] }) })
      .expect(400);
  });

  it('should reject with 400 when an entry fails validation', async () => {
    const badEntry = { ...validEntry, movieURL: 'not-a-url' };

    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry, badEntry] }) })
      .expect(400);

    expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
  });

  it('should rollback on database error', async () => {
    mockConnection.query.mockRejectedValueOnce(new Error('DB error'));

    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(500);

    expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });

  it('should accept request with X-Api-Key header', async () => {
    mockConnection.query.mockResolvedValue({ affectedRows: 1 });

    await request(app)
      .post('/api/newEntries')
      .set('X-Api-Key', process.env.MOVIETHING_VALID_API_KEY)
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(200);
  });
});
