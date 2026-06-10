# 🔭 Rétroviseur

Real-time Scrum retrospective tool for distributed teams. Multiple participants join a shared room and collaborate live — adding cards, voting, and discussing together.

## Features

- **4 retro formats** — Classic (Went Well / To Improve / Actions), Start/Stop/Continue, 4 Ls, Mad/Sad/Glad
- **Real-time collaboration** — cards, votes, and participants sync instantly across all connected users via WebSockets
- **Per-user voting** — each participant can vote once per card; vote counts are visible to everyone
- **Anonymous mode** — author names are hidden by default; the facilitator can reveal them at any time
- **Invite by link** — share a URL and participants join by entering their name, no account required
- **Facilitator controls** — reveal/hide author names, clear all votes
- **Facilitator handoff** — if the facilitator disconnects, the next participant is promoted automatically
- **Rooms auto-expire** — empty rooms are cleaned up after 1 hour

## Getting Started

### Local development

```bash
npm install
npm run dev      # auto-reloads with nodemon
```

Open [http://localhost:3000](http://localhost:3000).

### Production

```bash
npm install
npm start
```

### Docker

```bash
docker build -t retroviseur .
docker run -p 3000:3000 retroviseur
```

The app listens on port `3000` by default. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
# or
docker run -p 8080:3000 -e PORT=3000 retroviseur
```

## Usage

1. **Create a room** — choose a retro format, enter your name and an optional session name. You become the facilitator.
2. **Invite your team** — share the room URL (`/room.html?code=XXXXXX`) or the 6-character room code.
3. **Add cards** — click *Add a card* at the bottom of any column. Press `Ctrl+Enter` to submit, `Escape` to cancel.
4. **Vote** — click the 👍 button on any card to vote or unvote.
5. **Edit / delete** — click ✏️ or 🗑 on your own cards (facilitator can edit or delete any card).
6. **Reveal authors** — the facilitator can toggle author names on/off for the whole room.
7. **Clear votes** — the facilitator can reset all vote counts to start a fresh prioritisation round.

## Project Structure

```
retroviseur/
├── server.js          # Express + Socket.io server, in-memory room state
├── public/
│   ├── index.html     # Landing page (create / join)
│   ├── room.html      # Retro room shell
│   ├── room.js        # Client-side Socket.io logic and DOM rendering
│   └── style.css      # All styles
├── Dockerfile
└── package.json
```

## Tech Stack

| Layer | Technology |
|---|---|
| Server | [Node.js](https://nodejs.org) + [Express](https://expressjs.com) |
| Real-time | [Socket.io](https://socket.io) |
| Frontend | Vanilla JS, HTML, CSS (no build step) |
| Storage | In-memory (no database) |
| Container | Docker (Alpine-based) |

## Architecture Notes

Room state lives entirely in server memory. There is no database — if the server restarts, active rooms are lost. This keeps the deployment simple (single process, no external dependencies) and is appropriate for ephemeral retro sessions.

Each card is serialised per-viewer before being sent: the author name is redacted server-side when anonymous mode is on, preventing client-side bypass. Vote state (whether *you* have voted) is also computed per-socket on the server.
