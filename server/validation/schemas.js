'use strict';

const { z } = require('zod');

// viewingDate format from the datepicker: MM/dd/yyyy
const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;

const newEntrySchema = z.object({
  movieTitle: z.string().min(1),
  viewingDate: z.string().regex(datePattern, 'viewingDate must be MM/DD/YYYY'),
  movieURL: z.string().url(),
  viewFormat: z.string().min(1),
  viewLocation: z.string().min(1),
  movieGenre: z.string().min(1),
  movieReview: z.string().default(''),
  firstViewing: z.boolean()
});

const updateEntrySchema = z.object({
  viewingDate: z.string().regex(datePattern, 'viewingDate must be MM/DD/YYYY'),
  viewFormat: z.string().min(1),
  viewLocation: z.string().min(1),
  movieGenre: z.string().min(1),
  movieReview: z.string().default(''),
  firstViewing: z.boolean()
});

module.exports = { newEntrySchema, updateEntrySchema };
