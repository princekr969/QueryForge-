'use strict'

/**
 * minioClient.js
 * Downloads a partition CSV from MinIO to a temp file on disk.
 * Using a temp file avoids backpressure issues when piping large objects
 * directly from MinIO stream into csv-parse.
 */

const fs   = require('fs')
const path = require('path')
const { Client } = require('minio')

const minioClient = new Client({
  endPoint:  process.env.MINIO_ENDPOINT || 'minio',
  port:      parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL:    false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
})

const PARTITIONS_BUCKET = 'partitions'

/**
 * Download a partition from MinIO to /tmp/{taskId}.csv
 * Returns the local file path. Caller is responsible for deleting it.
 *
 * @param {string} objectPath  - MinIO object key, e.g. "uuid/partition-0.csv"
 * @param {string} taskId      - used to create a unique temp filename
 * @returns {Promise<string>}  - absolute path to the downloaded temp file
 */
async function downloadPartitionToFile (objectPath, taskId) {
  const localPath = path.join('/tmp', `${taskId}.csv`)

  const stream = await minioClient.getObject(PARTITIONS_BUCKET, objectPath)

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(localPath)

    stream.pipe(fileStream)
    fileStream.on('finish', () => resolve(localPath))
    fileStream.on('error', (err) => {
      // Clean up partial file on write error
      fs.unlink(localPath, () => {})
      reject(err)
    })
    stream.on('error', (err) => {
      fs.unlink(localPath, () => {})
      reject(err)
    })
  })
}

/**
 * Delete temp file after processing — fire and forget.
 */
function cleanupTempFile (localPath) {
  fs.unlink(localPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[MinIO] Failed to delete temp file ${localPath}:`, err.message)
    }
  })
}

module.exports = { downloadPartitionToFile, cleanupTempFile }
