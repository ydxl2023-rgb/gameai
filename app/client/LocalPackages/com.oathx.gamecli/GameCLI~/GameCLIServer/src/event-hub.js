import { createHash, randomUUID } from 'node:crypto';
import { message } from './protocol.js';

// This bounded, volatile replay buffer is transport state, not a task database.
export class EventHub
{
    constructor(projects, retention = 1000)
    {
        this.serverId = randomUUID();
        this.retention = retention;
        this.streams = new Map(projects.map(project => [project, { sequence: 0, events: [], hashes: new Map() }]));
    }

    publish(event, body)
    {
        const stream = this.streams.get(event.project_key);
        if (!stream)
        {
            return null;
        }
        const hash = createHash('sha256').update(body).digest('hex');
        if (stream.hashes.has(hash))
        {
            return { duplicate: true, envelope: stream.hashes.get(hash) };
        }
        const envelope = message('jira.issue_changed', { ...event, server_id: this.serverId, sequence: ++stream.sequence });
        stream.events.push({ hash, envelope });
        stream.hashes.set(hash, envelope);
        if (stream.events.length > this.retention)
        {
            stream.hashes.delete(stream.events.shift().hash);
        }
        return { duplicate: false, envelope };
    }

    resume(project, cursor)
    {
        const stream = this.streams.get(project);
        if (!stream)
        {
            throw new Error('项目未开放订阅。');
        }
        const oldest = stream.events[0]?.envelope.payload.sequence ?? stream.sequence + 1;
        const valid = cursor && cursor.server_id === this.serverId && Number.isSafeInteger(cursor.sequence) && cursor.sequence >= oldest - 1 && cursor.sequence <= stream.sequence;
        return {
            server_id: this.serverId,
            resume_sequence: valid ? cursor.sequence : stream.sequence,
            resync_required: !valid,
            reason: valid ? 'resume' : !cursor ? 'initial_sync' : cursor.server_id !== this.serverId ? 'server_restarted' : 'replay_gap',
            replay: valid ? stream.events.filter(item => item.envelope.payload.sequence > cursor.sequence).map(item => item.envelope) : []
        };
    }
}
