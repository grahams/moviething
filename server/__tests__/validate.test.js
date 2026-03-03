const { validate } = require('../middleware/validate');
const { newEntrySchema } = require('../validation/schemas');

const validBody = {
  movieTitle: 'Test Movie',
  viewingDate: '01/01/2024',
  movieURL: 'https://www.imdb.com/title/tt1234567/',
  viewFormat: 'Digital',
  viewLocation: 'Home',
  movieGenre: 'Action',
  movieReview: 'Great movie!',
  firstViewing: true
};

function makeReq(body) {
  return { body: { json: JSON.stringify(body) } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  const next = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('calls next() when body is valid', () => {
    const middleware = validate(newEntrySchema);
    middleware(makeReq(validBody), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('sets req.validatedBody on success', () => {
    const middleware = validate(newEntrySchema);
    const req = makeReq(validBody);
    middleware(req, makeRes(), next);
    expect(req.validatedBody).toMatchObject({ movieTitle: 'Test Movie' });
  });

  it('returns 400 when movieTitle is missing', () => {
    const middleware = validate(newEntrySchema);
    const body = { ...validBody };
    delete body.movieTitle;
    const res = makeRes();
    middleware(makeReq(body), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when viewingDate format is wrong (YYYY-MM-DD instead of MM/DD/YYYY)', () => {
    const middleware = validate(newEntrySchema);
    const res = makeRes();
    middleware(makeReq({ ...validBody, viewingDate: '2024-01-01' }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when req.body.json is missing', () => {
    const middleware = validate(newEntrySchema);
    const res = makeRes();
    middleware({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
