import { EventEmitter } from 'events';

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) {
    return target;
  }
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export class AgentDataStore extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.snapshot = {
      status: {
        connected: false,
        injected: false
      },
      server: {
        version: null,
        type: null,
        typeDisplay: null
      },
      runtime: {
        loadedClasses: null,
        canRetransform: null,
        canRedefine: null
      },
      jvm: {
        java: null,
        memory: {
          usedMB: null,
          maxMB: null
        },
        processors: null
      },
      mapping: {
        status: 'unknown',
        path: null,
        version: null,
        source: null,
        error: null,
        updatedAt: null
      },
      updatedAt: null
    };
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  update(partial) {
    this.snapshot = deepMerge(this.snapshot, partial);
    this.snapshot.updatedAt = Date.now();
    this.emit('update', this.getSnapshot());
  }

  updateStatus(statusPatch) {
    this.update({ status: statusPatch });
    this.emit('status', this.snapshot.status);
  }

  setServerMetadata(metadata = {}) {
    this.update({
      server: {
        version: metadata.version ?? this.snapshot.server.version,
        type: metadata.serverType ?? metadata.type ?? this.snapshot.server.type,
        typeDisplay: metadata.serverTypeDisplay ?? this.snapshot.server.typeDisplay
      }
    });
    this.emit('server', this.snapshot.server);
  }

  setRuntimeInfo(info = {}) {
    this.update({
      runtime: {
        loadedClasses: info.loadedClasses ?? null,
        canRetransform: info.canRetransform ?? null,
        canRedefine: info.canRedefine ?? null
      }
    });
    this.emit('runtime', this.snapshot.runtime);
  }

  setJvmInfo(info = {}) {
    this.update({
      jvm: {
        java: info.java ?? null,
        memory: {
          usedMB: info.memory?.usedMB ?? null,
          maxMB: info.memory?.maxMB ?? null
        },
        processors: info.processors ?? null
      }
    });
    this.emit('jvm', this.snapshot.jvm);
  }

  setMappingState(state = {}) {
    const merged = {
      status: state.status ?? this.snapshot.mapping.status,
      path: state.path ?? this.snapshot.mapping.path,
      version: state.version ?? this.snapshot.mapping.version,
      source: state.source ?? this.snapshot.mapping.source,
      error: state.error ?? null,
      updatedAt: Date.now()
    };
    this.update({ mapping: merged });
    this.emit('mapping', this.snapshot.mapping);
  }
}

