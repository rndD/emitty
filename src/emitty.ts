'use strict';

import * as fs from 'fs';
import * as stream from 'stream';

import { IStorage, StorageService } from './services/storage';
import { ILanguage, ConfigService } from './services/config';
import { ScannerService } from './services/scanner';
import { ResolverProvider } from './providers/resolver';
import { StreamProvider } from './providers/stream';

import * as pathUtils from './utils/paths';
import * as fsUtils from './utils/fs';

export interface IScannerOptions {
	/**
	 * The maximum number of nested directories to scan.
	 */
	depth?: number;
	/**
	 * List of Glob-patterns for directories that are excluded when scanning.
	 */
	exclude?: string[];
}

export interface IOptions {
	/**
	 * You can load the previous state of the project in the Storage using this option.
	 */
	snapshot?: IStorage;
	/**
	 * The function that will be called if the file needs to be compiled.
	 */
	log?: (filepath: string) => void;
	/**
	 * Cleanup interval time in seconds for Storage.
	 */
	cleanupInterval?: number;
	/**
	 * Options for Scanner.
	 */
	scanner?: IScannerOptions;
	/**
	 * Creates a Vinyl file for the file which should be compiled.
	 */
	makeVinylFile?: boolean;
	/**
	 * The root directory of all absolute inclusion.
	 */
	basedir?: string;
}

export interface IEmittyApi {
	/**
	 * Returns a snapshot of the Storage.
	 */
	storage: () => IStorage;
	/**
	 * Returns the keys of the Storage.
	 */
	keys: () => string[];
	/**
	 * Clears the Storage and loads the new data.
	 */
	load: (snapshot: IStorage) => void;
	/**
	 * Scans directory and updates the Storage.
	 */
	scan: (filepath?: string, stats?: fs.Stats) => Promise<void>;
	/**
	 * Returns the methods for determining dependencies.
	 */
	resolver: ResolverProvider;
	/**
	 * Scans directory or file and updates the Storage.
	 */
	stream: (filepath?: string, stats?: fs.Stats) => stream.Transform;
}

function assertInput(directory: string, language: string | ILanguage): void {
	if (!directory) {
		throw new TypeError('directory must be a string');
	}

	const type = typeof language;
	if (!language || (type !== 'string' && type !== 'object')) {
		throw new TypeError('language must be a string or an object');
	}
	if (!fsUtils.pathExistsSync(directory)) {
		throw new Error('directory must exist');
	}
}

export function setup(root: string, language: string | ILanguage, options?: IOptions) {
	assertInput(root, language);

	const storage = new StorageService();

	options = Object.assign(<IOptions>{
		snapshot: {},
		cleanupInterval: null,
		log: () => console.log,
		vinylFile: false,
		basedir: null
	}, options);

	options.scanner = Object.assign(<IScannerOptions>{
		depth: 30,
		exclude: ['.git', '**/node_modules', '**/bower_components']
	}, options.scanner);

	// Loading data if provided dependency tree
	if (options.snapshot) {
		storage.load(options.snapshot);
	}

	// Run invalidation
	if (options.cleanupInterval) {
		storage.startInvalidation(options.cleanupInterval * 1000);
	}

	// Expanding of Glob-patterns that should be excluded during scanning
	if (options.scanner.exclude) {
		options.scanner.exclude = pathUtils.expandGlobPatterns(options.scanner.exclude);
	}

	root = pathUtils.normalize(root);

	const configService = new ConfigService(language);
	const scannerService = new ScannerService(root, storage, configService.getConfig(), options);
	const resolverProvider = new ResolverProvider(storage);
	const streamProvider = new StreamProvider(root, storage, configService.getConfig(), options);

	return <IEmittyApi>{
		storage: () => storage.snapshot(),
		keys: () => storage.keys(),
		load: (snapshot: IStorage) => storage.load(snapshot),
		scan: (filepath?: string, stats?: fs.Stats) => scannerService.scan(filepath, stats),
		resolver: resolverProvider,
		stream: (filepath?: string, stats?: fs.Stats): stream.Transform => streamProvider.run(filepath, stats),
		filter: (filepath: string): stream.Transform => streamProvider.filter(filepath)
	};
}
