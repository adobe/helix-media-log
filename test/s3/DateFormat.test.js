/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

import assert from 'assert';
import DateFormat from '../../src/s3/DateFormat.js';

describe('DateFormat Tests', () => {
  it('formats date correctly', () => {
    const date = new Date('2024-01-15T10:30:45Z');
    const formatted = DateFormat.format(date);
    assert.strictEqual(formatted, '2024-01-15-10-30-45');
  });

  it('parses date correctly', () => {
    const formatted = '2024-01-15-10-30-45';
    const date = DateFormat.parse(formatted);
    assert.strictEqual(date.toISOString(), '2024-01-15T10:30:45.000Z');
  });

  it('round-trips date correctly', () => {
    const original = new Date('2024-01-15T10:30:45Z');
    const formatted = DateFormat.format(original);
    const parsed = DateFormat.parse(formatted);
    assert.strictEqual(parsed.getTime(), original.getTime());
  });
});
