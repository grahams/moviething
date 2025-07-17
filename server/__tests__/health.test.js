const request = require('supertest');
const { app } = require('../index');

describe('Health Endpoint', () => {
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

    // Verify timestamp is a valid ISO string
    expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    
    // Verify uptime is a positive number
    expect(response.body.uptime).toBeGreaterThan(0);
  });

  it('should have correct content type', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect('Content-Type', /json/);
  });
}); 