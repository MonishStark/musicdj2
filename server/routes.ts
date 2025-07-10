/** @format */

import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
	processingSettingsSchema,
	updateAudioTrackSchema,
} from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import { PythonShell } from "python-shell";

// Setup multer for file uploads
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
	fs.mkdirSync(uploadsDir);
}

const resultDir = path.join(process.cwd(), "results");
if (!fs.existsSync(resultDir)) {
	fs.mkdirSync(resultDir);
}

// Security: Define allowed directories for file operations
const ALLOWED_DIRECTORIES = [path.resolve(uploadsDir), path.resolve(resultDir)];

// Security: Allowed file extensions
const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".flac", ".aiff"];

/**
 * Security function to validate and sanitize file paths
 * @param filePath - The file path to validate
 * @returns Sanitized path if valid, null if invalid
 */
function validateAndSanitizePath(filePath: string): string | null {
	try {
		// Resolve the absolute path to prevent traversal
		const resolvedPath = path.resolve(filePath);

		// Check if the resolved path is within allowed directories
		const isInAllowedDirectory = ALLOWED_DIRECTORIES.some(
			(allowedDir) =>
				resolvedPath.startsWith(allowedDir + path.sep) ||
				resolvedPath === allowedDir
		);

		if (!isInAllowedDirectory) {
			return null;
		}

		// Check file extension
		const fileExtension = path.extname(resolvedPath).toLowerCase();
		if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
			return null;
		}

		// Additional security checks
		if (resolvedPath.includes("..") || resolvedPath.includes("~")) {
			return null;
		}

		return resolvedPath;
	} catch (error) {
		return null;
	}
}

/**
 * Security function to create safe output paths
 * @param baseDir - Base directory (must be in allowed directories)
 * @param filename - Filename to create
 * @returns Safe path or null if invalid
 */
function createSafeOutputPath(
	baseDir: string,
	filename: string
): string | null {
	try {
		// Sanitize filename - remove any path separators and dangerous characters
		const sanitizedFilename = filename.replace(/[\/\\:*?"<>|]/g, "_");

		// Ensure baseDir is allowed
		const resolvedBaseDir = path.resolve(baseDir);
		const isAllowedBaseDir = ALLOWED_DIRECTORIES.some((allowedDir) =>
			resolvedBaseDir.startsWith(allowedDir)
		);

		if (!isAllowedBaseDir) {
			return null;
		}

		// Create the output path
		const outputPath = path.join(resolvedBaseDir, sanitizedFilename);

		// Validate the final path
		return validateAndSanitizePath(outputPath);
	} catch (error) {
		return null;
	}
}

const storage_config = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadsDir);
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		cb(null, uniqueSuffix + path.extname(file.originalname));
	},
});

const upload = multer({
	storage: storage_config,
	limits: {
		fileSize: 15 * 1024 * 1024, // 15MB file size limit
	},
	fileFilter: (req, file, cb) => {
		const allowedMimeTypes = [
			"audio/mpeg",
			"audio/wav",
			"audio/flac",
			"audio/aiff",
			"audio/x-aiff",
		];
		if (allowedMimeTypes.includes(file.mimetype)) {
			cb(null, true);
		} else {
			cb(
				new Error(
					"Invalid file type. Only MP3, WAV, FLAC, and AIFF files are allowed."
				)
			);
		}
	},
});

export async function registerRoutes(app: Express): Promise<Server> {
	const httpServer = createServer(app);

	// Set up user for demo purposes
	let demoUser = await storage.getUserByUsername("demo");
	if (!demoUser) {
		demoUser = await storage.createUser({
			username: "demo",
			password: "password", // In a real app, this would be hashed
		});
	}

	/**
	 * Route Handlers Documentation
	 *
	 * POST /api/tracks/upload
	 * - Handles audio file upload
	 * - Creates track entry in database
	 * - Analyzes audio for basic info (format, tempo, key)
	 *
	 * GET /api/tracks/:id
	 * - Retrieves specific track information
	 *
	 * GET /api/tracks
	 * - Lists all tracks for demo user
	 *
	 * DELETE /api/tracks
	 * - Clears all tracks and associated files
	 *
	 * POST /api/tracks/:id/process
	 * - Processes track to create extended version
	 * - Handles versioning and status updates
	 *
	 * GET /api/tracks/:id/status
	 * - Returns current processing status
	 *
	 * GET /api/audio/:id/:type
	 * - Streams audio files (original or extended)
	 *
	 * GET /api/tracks/:id/download
	 * - Handles download of processed tracks
	 */

	// Upload audio file
	app.post(
		"/api/tracks/upload",
		upload.single("audio"),
		async (req: Request, res: Response) => {
			try {
				if (!req.file) {
					return res.status(400).json({ message: "No file uploaded" });
				}

				// Security: Validate uploaded file path
				const safeUploadPath = validateAndSanitizePath(req.file.path);
				if (!safeUploadPath) {
					// Clean up unsafe file
					if (fs.existsSync(req.file.path)) {
						fs.unlinkSync(req.file.path);
					}
					return res.status(400).json({
						message: "Invalid upload path - file rejected",
					});
				}

				const track = await storage.createAudioTrack({
					originalFilename: req.file.originalname,
					originalPath: safeUploadPath,
					userId: demoUser.id, // Using demo user for now
				});

				// Get basic audio info using Python
				const options = {
					mode: "text" as const,
					pythonPath: process.platform === "win32" ? "python" : "python3",
					pythonOptions: ["-u"],
					scriptPath: path.join(process.cwd(), "server"),
					args: [safeUploadPath],
				};

				PythonShell.run("utils.py", options)
					.then(async (results) => {
						if (results && results.length > 0) {
							try {
								const audioInfo = JSON.parse(results[0]);
								await storage.updateAudioTrack(track.id, {
									format: audioInfo.format,
									bitrate: audioInfo.bitrate || null,
									duration: audioInfo.duration || null,
									bpm: audioInfo.bpm || null,
									key: audioInfo.key || null,
								});
							} catch (e) {
								console.error("Error parsing audio info:", e);
							}
						}
					})
					.catch((err) => {
						console.error("Error analyzing audio:", err);
					});

				return res.status(201).json(track);
			} catch (error) {
				console.error("Upload error:", error);
				return res
					.status(500)
					.json({ message: "Error uploading file", error: error.message });
			}
		}
	);

	// Get a specific track
	app.get("/api/tracks/:id", async (req: Request, res: Response) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (isNaN(id)) {
				return res.status(400).json({ message: "Invalid track ID" });
			}

			const track = await storage.getAudioTrack(id);
			if (!track) {
				return res.status(404).json({ message: "Track not found" });
			}

			return res.json(track);
		} catch (error) {
			console.error("Get track error:", error);
			return res
				.status(500)
				.json({ message: "Error retrieving track", error: error.message });
		}
	});

	// Get all tracks for the demo user
	app.get("/api/tracks", async (req: Request, res: Response) => {
		try {
			const tracks = await storage.getAudioTracksByUserId(demoUser.id);
			return res.json(tracks);
		} catch (error) {
			console.error("Get tracks error:", error);
			return res
				.status(500)
				.json({ message: "Error retrieving tracks", error: error.message });
		}
	});

	// Clear all tracks
	app.delete("/api/tracks", async (req: Request, res: Response) => {
		try {
			const tracks = await storage.getAudioTracksByUserId(demoUser.id);

			// Delete files
			for (const track of tracks) {
				// Security: Validate original path before deletion
				const safeOriginalPath = validateAndSanitizePath(track.originalPath);
				if (safeOriginalPath && fs.existsSync(safeOriginalPath)) {
					fs.unlinkSync(safeOriginalPath);
				}

				// Security: Validate extended paths before deletion
				if (Array.isArray(track.extendedPaths)) {
					for (const filePath of track.extendedPaths) {
						const safePath = validateAndSanitizePath(filePath as string);
						if (safePath && fs.existsSync(safePath)) {
							fs.unlinkSync(safePath);
						}
					}
				}
			}

			// Delete from database
			await storage.deleteAllUserTracks(demoUser.id);

			return res.json({ message: "All tracks cleared" });
		} catch (error) {
			console.error("Clear tracks error:", error);
			return res
				.status(500)
				.json({ message: "Error clearing tracks", error: error.message });
		}
	});

	// Process a track to create extended version
	app.post("/api/tracks/:id/process", async (req: Request, res: Response) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (isNaN(id)) {
				return res.status(400).json({ message: "Invalid track ID" });
			}

			const track = await storage.getAudioTrack(id);
			if (!track) {
				return res.status(404).json({ message: "Track not found" });
			}

			// Check version limit

			if (track.versionCount > 3) {
				return res.status(400).json({
					message: "Maximum version limit (3) reached",
				});
			}

			// Validate settings from request
			const settings = processingSettingsSchema.parse(req.body);

			// Update track status and settings
			await storage.updateAudioTrack(id, {
				status:
					Array.isArray(track.extendedPaths) && track.extendedPaths.length > 0
						? "regenerate"
						: "processing",
				settings: settings,
			});

			// Generate a filename for the extended version
			const outputBase = path.basename(
				track.originalFilename,
				path.extname(track.originalFilename)
			);
			const fileExt = path.extname(track.originalFilename);
			const version = Array.isArray(track.extendedPaths)
				? track.extendedPaths.length
				: 0;

			// Security: Create safe output path using sanitized filename
			const safeFilename = `${outputBase}_extended_v${version + 1}${fileExt}`;
			const outputPath = createSafeOutputPath(resultDir, safeFilename);

			if (!outputPath) {
				return res.status(400).json({
					message: "Invalid output path - unable to create safe file path",
				});
			}

			// Execute the Python script for audio processing
			const options = {
				mode: "text" as const,
				pythonPath: process.platform === "win32" ? "python" : "python3",
				pythonOptions: ["-u"],
				scriptPath: path.join(process.cwd(), "server"),
				args: [
					track.originalPath,
					outputPath,
					settings.introLength.toString(),
					settings.outroLength.toString(),
					settings.preserveVocals.toString(),
					settings.beatDetection,
				],
			};

			// Send initial response
			res.status(202).json({
				message: "Processing started",
				trackId: id,
				status: "processing",
			});

			// Start processing in background
			PythonShell.run("audioProcessor.py", options)
				.then(async (results) => {
					console.log("Processing complete:", results);

					// Get audio info of the processed file
					const audioInfoOptions = {
						mode: "text" as const,
						pythonPath: process.platform === "win32" ? "python" : "python3",
						pythonOptions: ["-u"],
						scriptPath: path.join(process.cwd(), "server"),
						args: [outputPath],
					};

					return PythonShell.run("utils.py", audioInfoOptions).then(
						async (infoResults) => {
							let extendedDuration = null;

							if (infoResults && infoResults.length > 0) {
								try {
									const audioInfo = JSON.parse(infoResults[0]);
									console.log("Extended audio info:", audioInfo);
									extendedDuration = audioInfo.duration || null;
								} catch (e) {
									console.error("Error parsing extended audio info:", e);
								}
							}

							// Update track with completed status and add new version
							const track = await storage.getAudioTrack(id);
							if (!track) {
								throw new Error("Track not found after processing");
							}

							const currentPaths = Array.isArray(track.extendedPaths)
								? track.extendedPaths
								: [];
							const currentDurations = Array.isArray(track.extendedDurations)
								? track.extendedDurations
								: [];
							let extendedPaths = [...currentPaths, outputPath];
							console.log("extendedPaths:", extendedPaths);

							return storage.updateAudioTrack(id, {
								status: "completed",
								extendedPaths: extendedPaths,
								extendedDurations: [...currentDurations, extendedDuration],
								versionCount: (track.versionCount || 1) + 1,
							});
						}
					);
				})
				.catch(async (error) => {
					console.error("Processing error:", error);
					await storage.updateAudioTrack(id, {
						status: "error",
					});
				});
		} catch (error) {
			console.error("Process track error:", error);
			return res
				.status(500)
				.json({ message: "Error processing track", error: error.message });
		}
	});

	// Get processing status
	app.get("/api/tracks/:id/status", async (req: Request, res: Response) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (isNaN(id)) {
				return res.status(400).json({ message: "Invalid track ID" });
			}

			const track = await storage.getAudioTrack(id);
			if (!track) {
				return res.status(404).json({ message: "Track not found" });
			}

			return res.json({ status: track.status });
		} catch (error) {
			console.error("Get status error:", error);
			return res
				.status(500)
				.json({ message: "Error retrieving status", error: error.message });
		}
	});

	// Serve audio files
	app.get("/api/audio/:id/:type", async (req: Request, res: Response) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (isNaN(id)) {
				return res.status(400).json({ message: "Invalid track ID" });
			}

			const type = req.params.type;
			if (type !== "original" && type !== "extended") {
				return res.status(400).json({ message: "Invalid audio type" });
			}

			const track = await storage.getAudioTrack(id);
			if (!track) {
				return res.status(404).json({ message: "Track not found" });
			}

			let filePath = track.originalPath;
			if (type === "extended") {
				const version = parseInt(req.query.version as string) || 0;
				const extendedPaths = Array.isArray(track.extendedPaths)
					? track.extendedPaths
					: [];
				filePath = extendedPaths[version];
			}

			if (!filePath) {
				return res
					.status(404)
					.json({ message: `${type} audio file not found` });
			}

			// Security: Validate and sanitize the file path
			const safePath = validateAndSanitizePath(filePath);
			if (!safePath) {
				return res.status(400).json({
					message: "Invalid file path - path validation failed",
				});
			}

			if (!fs.existsSync(safePath)) {
				return res
					.status(404)
					.json({ message: "Audio file not found on disk" });
			}

			const stat = fs.statSync(safePath);
			const fileSize = stat.size;
			const range = req.headers.range;

			if (range) {
				const parts = range.replace(/bytes=/, "").split("-");
				const start = parseInt(parts[0], 10);
				const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
				const chunksize = end - start + 1;
				const file = fs.createReadStream(safePath, { start, end });
				const head = {
					"Content-Range": `bytes ${start}-${end}/${fileSize}`,
					"Accept-Ranges": "bytes",
					"Content-Length": chunksize,
					"Content-Type": "audio/mpeg",
				};
				res.writeHead(206, head);
				file.pipe(res);
			} else {
				const head = {
					"Content-Length": fileSize,
					"Content-Type": "audio/mpeg",
				};
				res.writeHead(200, head);
				fs.createReadStream(safePath).pipe(res);
			}
		} catch (error) {
			console.error("Stream audio error:", error);
			return res.status(500).json({
				message: "Error streaming audio",
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Download extended audio
	app.get("/api/tracks/:id/download", async (req: Request, res: Response) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (isNaN(id)) {
				return res.status(400).json({ message: "Invalid track ID" });
			}

			const track = await storage.getAudioTrack(id);
			if (!track) {
				return res.status(404).json({ message: "Track not found" });
			}

			const version = parseInt(req.query.version as string) || 0;
			const extendedPaths = Array.isArray(track.extendedPaths)
				? track.extendedPaths
				: [];

			if (version >= extendedPaths.length || !extendedPaths[version]) {
				return res.status(404).json({ message: "Extended version not found" });
			}

			const filePath = extendedPaths[version];

			// Security: Validate and sanitize the file path
			const safePath = validateAndSanitizePath(filePath);
			if (!safePath) {
				return res.status(400).json({
					message: "Invalid file path - path validation failed",
				});
			}

			if (!fs.existsSync(safePath)) {
				return res
					.status(404)
					.json({ message: "Extended audio file not found on disk" });
			}

			// Extract original filename without extension
			const originalNameWithoutExt = path.basename(
				track.originalFilename,
				path.extname(track.originalFilename)
			);

			// Create download filename with version number
			const downloadFilename = `${originalNameWithoutExt}_extended_v${
				version + 1
			}${path.extname(track.originalFilename)}`;

			res.download(safePath, downloadFilename);
		} catch (error) {
			console.error("Download error:", error);
			return res.status(500).json({
				message: "Error downloading file",
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	return httpServer;
}
