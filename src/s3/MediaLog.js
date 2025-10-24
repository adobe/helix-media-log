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

import crypto from 'crypto';
import { promisify } from 'util';
import zlib from 'zlib';
import {
  GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Response } from '@adobe/fetch';
import DateFormat from './DateFormat.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Bucket to use for media logging.
 */
const BUCKET_NAME = 'helix-media-logs';

/**
 * Index file in project folder. This is a LF separated text file with
 * the list of all log files in ascending order.
 */
const INDEX_FILE = '.index';

/**
 * Metadata property for last event in log file. We update that property
 * whenever we store events to a log file.
 */
const META_LAST_EVENT = 'last-event-time';

/**
 * Threshold size to allow in one log file.
 */
const MAX_OBJECT_SIZE = 512 * 1024;

/**
 * Generate log file from date and some random value.
 *
 * @returns log file, consisting of name and date created
 */
function generateID() {
  return `${DateFormat.format(new Date())}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Media log implemented in S3
 */
export default class MediaLog {
  constructor(opts) {
    this.s3 = opts.s3;
    this.org = opts.org;
    this.site = opts.site;
    this.log = opts.log;
  }

  /**
   * Creates the S3 client
   *
   * @returns {S3Client} S3 client
   */
  static async createClient() {
    return new S3Client({});
  }

  /**
   * Fetch index file
   */
  async #fetchIndex() {
    const { org, site, s3 } = this;

    // fetch name of last log object
    try {
      const res = await s3.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${org}/${site}/${INDEX_FILE}`,
      }));
      const logContents = await new Response(res.Body, {}).text();
      return logContents.split('\n');
    } catch (e) {
      /* c8 ignore next 3 */
      if (e.$metadata.httpStatusCode !== 404) {
        throw e;
      }
    }
    return [];
  }

  /**
   * Fetch log file. Returns null if the log file is not found or too large to accommodate
   * another record.
   *
   * @param {string} key key for object to fetch
   * @returns {Promise<object>} object containing a key and contents
   */
  async #fetchLogFile(key) {
    const { s3 } = this;

    try {
      const res = await s3.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${key}.gz`,
      }));
      if (res.ContentLength < MAX_OBJECT_SIZE) {
        const buf = await new Response(res.Body, {}).buffer();
        return { key, contents: JSON.parse(await gunzip(buf)) };
      }
    } catch (e) {
    /* c8 ignore next 3 */
      if (e.$metadata.httpStatusCode !== 404) {
        throw e;
      }
    }
    return null;
  }

  /**
   * Retrieves the last log object or creates one if necessary.
   *
   * @returns an object containing a key and contents
   */
  async getOrCreateLogObject() {
    const { org, site, s3 } = this;

    // fetch list of log files
    const logFiles = await this.#fetchIndex();

    // fetch contents of last log object
    if (logFiles.length) {
      const key = `${org}/${site}/${logFiles[logFiles.length - 1]}`;
      const logFile = await this.#fetchLogFile(key);
      if (logFile) {
        return logFile;
      }
    }

    // generate new last log object, store modified list in index
    logFiles.push(generateID());
    await s3.send(new PutObjectCommand({
      Body: logFiles.join('\n'),
      Bucket: BUCKET_NAME,
      ContentType: 'text/plain',
      Key: `${org}/${site}/${INDEX_FILE}`,
    }));
    return { key: `${org}/${site}/${logFiles[logFiles.length - 1]}`, contents: [] };
  }

  /**
   * Store a modified log file back to S3
   *
   * @param {string} key key for object to store, with project prefix
   * @param {Array} contents array of log entries to store
   * @param {object} metadata metadata to store to log file
   */
  async #storeLogFile(key, contents, metadata) {
    const { s3 } = this;
    await s3.send(new PutObjectCommand({
      Body: await gzip(JSON.stringify(contents)),
      Bucket: BUCKET_NAME,
      ContentEncoding: 'gzip',
      ContentType: 'application/json',
      Key: `${key}.gz`,
      Metadata: metadata,
    }));
  }

  /**
   * Creates the media log backed by an S3 folder
   *
   * @param {import('@adobe/helix-universal').UniversalContext} context context
   * @param {any} opts options
   * @returns {Promise<MediaLog>} media log
   */
  static async create(context, opts) {
    const { log } = context;
    const { org, site } = opts;

    const s3 = await MediaLog.createClient();
    return new MediaLog({
      s3, org, site, log,
    });
  }

  /**
   * Appends rows to the media log
   *
   * @param {Array} updates added rows
   * @returns {Promise<string>} key of the log file
   */
  async append(updates) {
    if (updates.length) {
      const { key, contents } = await this.getOrCreateLogObject();
      const lastEventTime = updates[updates.length - 1].timestamp;
      contents.push(...updates);
      await this.#storeLogFile(key, contents, {
        [META_LAST_EVENT]: DateFormat.format(new Date(lastEventTime)),
      });

      this.log.info(`Appended ${updates.length} media events to ${key}`);
      return `${key}.gz`;
    }
    return null;
  }

  /**
   * Close the media log (cleanup resources)
   */
  // eslint-disable-next-line class-methods-use-this
  close() {
    // Currently no cleanup needed, but keeping for API consistency
  }
}
