<!-- @format -->

# DJ Mix Extender

A web application that helps DJs create extended versions of tracks with custom intros and outros. This tool uses AI-powered audio processing to analyze and manipulate audio files.

## Features

- Upload audio tracks (MP3, WAV, FLAC, AIFF supported)
- Automatic beat detection and tempo analysis
- AI-powered audio separation into components (vocals, drums, bass, other)
- Customizable intro and outro lengths
- Multiple version support for each track
- Real-time audio preview
- Download processed tracks

## Prerequisites

Before you begin, ensure you have installed:

- Node.js (v20 or later)
- Python 3.11 or later
- FFmpeg

## Local Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd dj-mix-extender
```

2. Install Node.js dependencies:

```bash
npm install
```

3. Install Python dependencies:

```bash
pip install librosa numpy pydub madmom spleeter
```

4. Create necessary directories:

```bash
mkdir uploads results
```

5. Start the development server:

```bash
npm run dev
```

The application will be available at http://localhost:5000

## Project Structure

- `/client` - React frontend application
- `/server` - Express backend and Python audio processing
- `/shared` - Shared TypeScript types and schemas
- `/pretrained_models` - AI models for audio processing

## Development

- Frontend code is in `/client/src`
- Main server routes are in `/server/routes.ts`
- Audio processing logic is in `/server/audioProcessor.py`
- Database operations are in `/server/storage.ts`

## Known Limitations

- Supported formats: MP3, WAV, FLAC, AIFF
- Processing time varies based on file size and complexity

## Contributing

Feel free to submit issues and enhancement requests.
