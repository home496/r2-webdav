/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
		// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
		// MY_KV_NAMESPACE: KVNamespace;
		//
		// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
		// MY_DURABLE_OBJECT: DurableObjectNamespace;
		//
		// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
		bucket: R2Bucket;
		//
		// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
		// MY_SERVICE: Fetcher;
		//
		// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
		// MY_QUEUE: Queue;

		// Variables defined in the "Environment Variables" section of the Wrangler CLI or dashboard
		USERNAME: string;
		PASSWORD: string;
		kv: KVNamespace;

}

async function* listAll(bucket: R2Bucket, prefix: string, isRecursive: boolean = false) {
		let cursor: string | undefined = undefined;
		do {
				var r2_objects = await bucket.list({
						prefix: prefix,
						delimiter: isRecursive ? undefined : '/',
						cursor: cursor,
						include: ['httpMetadata', 'customMetadata'],
				});

				for (let object of r2_objects.objects) {
						yield object;
				}

				if (r2_objects.truncated) {
						cursor = r2_objects.cursor;
				}
		} while (r2_objects.truncated);
}

type DavProperties = {
		creationdate: string | undefined;
		displayname: string | undefined;
		getcontentlanguage: string | undefined;
		getcontentlength: string | undefined;
		getcontenttype: string | undefined;
		getetag: string | undefined;
		getlastmodified: string | undefined;
		resourcetype: string;
		lockdiscovery: string | undefined;
};

function fromR2Object(object: R2Object | null | undefined): DavProperties {
		if (object === null || object === undefined) {
				return {
						creationdate: new Date().toUTCString(),
						displayname: undefined,
						getcontentlanguage: undefined,
						getcontentlength: '0',
						getcontenttype: undefined,
						getetag: undefined,
						lockdiscovery: undefined,
						getlastmodified: new Date().toUTCString(),
						resourcetype: '<collection />',
				};
		}

		return {
				creationdate: object.uploaded.toUTCString(),
				displayname: object.httpMetadata?.contentDisposition,
				getcontentlanguage: object.httpMetadata?.contentLanguage,
				getcontentlength: object.size.toString(),
				getcontenttype: object.httpMetadata?.contentType,
				getetag: object.etag,
				lockdiscovery: undefined,
				getlastmodified: object.uploaded.toUTCString(),
				resourcetype: object.customMetadata?.resourcetype ?? '',
		};
}

function make_resource_path(request: Request): string {
		let path = new URL(request.url).pathname.slice(1);
		path = path.endsWith('/') ? path.slice(0, -1) : path;
		return path;
}

async function handle_head(request: Request, bucket: R2Bucket): Promise<Response> {
		let response = await handle_get(request, bucket);
		return new Response(null, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
		});
}

async function handle_get(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		if (request.url.endsWith('/')) {
				let page = '';
				if (resource_path !== '') page += `<a href="../">..</a><br>`;
				for await (const object of listAll(bucket, resource_path)) {
						if (object.key === resource_path) {
								continue;
						}
						let href = `/${object.key + (object.customMetadata?.resourcetype === '<collection />' ? '/' : '')}`;
						page += `<a href="${href}">${object.httpMetadata?.contentDisposition ?? object.key}</a><br>`;
				}
				return new Response(page, {
						status: 200,
						headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
		} else {
				let object = await bucket.get(resource_path, {
						onlyIf: request.headers,
						range: request.headers,
				});

				if (object === null) {
						return new Response('Not Found', { status: 404 });
				}

				const headers = new Headers()
				object.writeHttpMetadata(headers)
				headers.set('etag', object.httpEtag)
				if (object.range) {
						headers.set("content-range", `bytes ${object.range.offset}-${object.range.end ?? object.size - 1}/${object.size}`)
				}
				const status = object.body ? (request.headers.get("range") !== null ? 206 : 200) : 304
				return new Response(object.body, {
						headers,
						status
				})

				// let isR2ObjectBody = (object: R2Object | R2ObjectBody): object is R2ObjectBody => {
				// 		return 'body' in object;
				// };
				//
				// if (object === null) {
				// 		return new Response('Not Found', { status: 404 });
				// } else if (!isR2ObjectBody(object)) {
				// 		console.log("get failed:", JSON.stringify(object))
				// 		return new Response('Precondition Failed', { status: 412 });
				// } else {
				// 		const { rangeOffset, rangeEnd } = calcContentRange(object);
				// 		const contentLength = rangeEnd - rangeOffset + 1;
				// 		return new Response(object.body, {
				// 				status: (object.range && contentLength !== object.size) ? 206 : 200,
				// 				headers: {
				// 						'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
				// 						'Content-Length': contentLength.toString(),
				// 						...({ 'Content-Range': `bytes ${rangeOffset}-${rangeEnd}/${object.size}` }),
				// 						...(object.httpMetadata?.contentDisposition
				// 								? {
				// 										'Content-Disposition': object.httpMetadata.contentDisposition,
				// 								}
				// 								: {}),
				// 						...(object.httpMetadata?.contentEncoding
				// 								? {
				// 										'Content-Encoding': object.httpMetadata.contentEncoding,
				// 								}
				// 								: {}),
				// 						...(object.httpMetadata?.contentLanguage
				// 								? {
				// 										'Content-Language': object.httpMetadata.contentLanguage,
				// 								}
				// 								: {}),
				// 						...(object.httpMetadata?.cacheControl
				// 								? {
				// 										'Cache-Control': object.httpMetadata.cacheControl,
				// 								}
				// 								: {}),
				// 						...(object.httpMetadata?.cacheExpiry
				// 								? {
				// 										'Cache-Expiry': object.httpMetadata.cacheExpiry.toISOString(),
				// 								}
				// 								: {}),
				// 				},
				// 		});
				// }
		}
}

function calcContentRange(object: R2ObjectBody) {
		let rangeOffset = 0;
		let rangeEnd = object.size - 1;
		if (object.range) {
				if ('suffix' in object.range) {
						// Case 3: {suffix: number}
						rangeOffset = object.size - object.range.suffix;
				} else {
						// Case 1: {offset: number, length?: number}
						// Case 2: {offset?: number, length: number}
						rangeOffset = object.range.offset ?? 0;
						let length = object.range.length ?? (object.size - rangeOffset);
						rangeEnd = Math.min(rangeOffset + length - 1, object.size - 1);
				}
		}
		return { rangeOffset, rangeEnd };
}

async function handle_put(request: Request, bucket: R2Bucket): Promise<Response> {
		if (request.url.endsWith('/')) {
				return new Response('Method Not Allowed', { status: 405 });
		}

		let resource_path = make_resource_path(request);

		// Check if the parent directory exists
		let dirpath = resource_path.split('/').slice(0, -1).join('/');
		if (dirpath !== '') {
				let dir = await bucket.head(dirpath);
				if (!(dir && dir.customMetadata?.resourcetype === '<collection />')) {
						return new Response('Conflict', { status: 409 });
				}
		}

		const object = await bucket.put(resource_path, request.body, {
				httpMetadata: request.headers,
		})
		return new Response(null, {
				headers: {
						'etag': object.httpEtag,
				},
				status: 201
		})
		// let body = await request.arrayBuffer();
		// await bucket.put(resource_path, body, {
		// 		onlyIf: request.headers,
		// 		httpMetadata: request.headers,
		// });
		// return new Response('', { status: 201 });
}

async function handle_delete(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		if (resource_path === '') {
				let r2_objects,
						cursor: string | undefined = undefined;
				do {
						r2_objects = await bucket.list({ cursor: cursor });
						let keys = r2_objects.objects.map((object) => object.key);
						if (keys.length > 0) {
								await bucket.delete(keys);
						}

						if (r2_objects.truncated) {
								cursor = r2_objects.cursor;
						}
				} while (r2_objects.truncated);

				return new Response(null, { status: 204 });
		}

		let resource = await bucket.head(resource_path);
		if (resource === null) {
				return new Response('Not Found', { status: 404 });
		}
		await bucket.delete(resource_path);
		if (resource.customMetadata?.resourcetype !== '<collection />') {
				return new Response(null, { status: 204 });
		}

		let r2_objects,
				cursor: string | undefined = undefined;
		do {
				r2_objects = await bucket.list({
						prefix: resource_path + '/',
						cursor: cursor,
				});
				let keys = r2_objects.objects.map((object) => object.key);
				if (keys.length > 0) {
						await bucket.delete(keys);
				}

				if (r2_objects.truncated) {
						cursor = r2_objects.cursor;
				}
		} while (r2_objects.truncated);

		return new Response(null, { status: 204 });
}

async function handle_mkcol(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		// Check if the resource already exists
		let resource = await bucket.head(resource_path);
		if (resource !== null) {
				return new Response('Method Not Allowed', { status: 405 });
		}

		// Check if the parent directory exists
		let parent_dir = resource_path.split('/').slice(0, -1).join('/');

		if (parent_dir !== '' && !(await bucket.head(parent_dir))) {
				return new Response('Conflict', { status: 409 });
		}

		await bucket.put(resource_path, new Uint8Array(), {
				httpMetadata: request.headers,
				customMetadata: { resourcetype: '<collection />' },
		});
		return new Response('', { status: 201 });
}

function generate_propfind_response(object: R2Object | null, lockXml: string | null): string {
		const supportedlock = `<supportedlock>
                    <lockentry>
                        <lockscope>
                            <exclusive/>
                        </lockscope>
                        <locktype>
                            <write/>
                        </locktype>
                    </lockentry>
                    <lockentry>
                        <lockscope>
                            <shared/>
                        </lockscope>
                        <locktype>
                            <write/>
                        </locktype>
                    </lockentry>
                </supportedlock>`;
		if (object === null) {
				return `
	<response>
		<href>/</href>
		<propstat>
			<prop>
			${Object.entries(fromR2Object(null))
						// .filter(([_, value]) => value !== undefined)
						.map(([key, value]) => `<${key}>${value ?? ''}</${key}>`)
						.join('\n				')}
			${supportedlock}
			</prop>
			<status>HTTP/1.1 200 OK</status>
		</propstat>
	</response>`;
		}

		let href = `/${object.key + (object.customMetadata?.resourcetype === '<collection />' ? '/' : '')}`;
		if(lockXml){
				return `
	<response>
		<href>${href}</href>
		<propstat>
			<prop>
			${Object.entries(fromR2Object(object))
						.filter(([_, value]) => value !== undefined)
						.map(([key, value]) => `<${key}>${value}</${key}>`)
						.join('\n				')}
			${supportedlock}
				${lockXml}
			</prop>
			<status>HTTP/1.1 200 OK</status>
		</propstat>
	</response>`;
		}

		return `
	<response>
		<href>${href}</href>
		<propstat>
			<prop>
			${Object.entries(fromR2Object(object))
				.filter(([_, value]) => value !== undefined)
				.map(([key, value]) => `<${key}>${value}</${key}>`)
				.join('\n				')}
			${supportedlock}
			</prop>
			<status>HTTP/1.1 200 OK</status>
		</propstat>
	</response>`;
}

async function handle_propfind(request: Request, bucket: R2Bucket, env: Env): Promise<Response> {
		let resource_path = make_resource_path(request);

		let is_collection: boolean;
		let page = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">`;

		if (resource_path === '') {
				page += generate_propfind_response(null, null);
				is_collection = true;
		} else {
				let object = await bucket.head(resource_path);
				if (object === null) {
						return new Response('Not Found', { status: 404 });
				}
				is_collection = object.customMetadata?.resourcetype === '<collection />';
				page += generate_propfind_response(object, await env.kv.get("lock_" + resource_path));
		}

		if (is_collection) {
				let depth = request.headers.get('Depth') ?? 'infinity';
				switch (depth) {
						case '0':
								break;
						case '1':
						{
								let prefix = resource_path === '' ? resource_path : resource_path + '/';
								for await (let object of listAll(bucket, prefix)) {
										page += generate_propfind_response(object, await env.kv.get("lock_" + object.key));
								}
						}
								break;
						case 'infinity':
						{
								let prefix = resource_path === '' ? resource_path : resource_path + '/';
								for await (let object of listAll(bucket, prefix, true)) {
										page += generate_propfind_response(object, await env.kv.get("lock_" + object.key));
								}
						}
								break;
						default: {
								return new Response('Forbidden', { status: 403 });
						}
				}
		}

		page += '\n</multistatus>\n';
		return new Response(page, {
				status: 207,
				headers: {
						'Content-Type': 'text/xml',
				},
		});
}

async function handle_copy(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);
		let dont_overwrite = request.headers.get('Overwrite') === 'F';
		let destination_header = request.headers.get('Destination');
		if (destination_header === null) {
				return new Response('Bad Request', { status: 400 });
		}
		let destination = new URL(destination_header).pathname.slice(1);
		destination = destination.endsWith('/') ? destination.slice(0, -1) : destination;

		// Check if the parent directory exists
		let destination_parent = destination
				.split('/')
				.slice(0, destination.endsWith('/') ? -2 : -1)
				.join('/');
		if (destination_parent !== '' && !(await bucket.head(destination_parent))) {
				return new Response('Conflict', { status: 409 });
		}

		// Check if the destination already exists
		let destination_exists = await bucket.head(destination);
		if (dont_overwrite && destination_exists) {
				return new Response('Precondition Failed', { status: 412 });
		}

		let resource = await bucket.head(resource_path);
		if (resource === null) {
				return new Response('Not Found', { status: 404 });
		}

		let is_dir = resource?.customMetadata?.resourcetype === '<collection />';

		if (is_dir) {
				let depth = request.headers.get('Depth') ?? 'infinity';
				switch (depth) {
						case 'infinity': {
								let prefix = resource_path + '/';
								const copy = async (object: R2Object) => {
										let target = destination + '/' + object.key.slice(prefix.length);
										target = target.endsWith('/') ? target.slice(0, -1) : target;
										let src = await bucket.get(object.key);
										if (src !== null) {
												await bucket.put(target, src.body, {
														httpMetadata: object.httpMetadata,
														customMetadata: object.customMetadata,
												});
										}
								};
								let promise_array = [copy(resource)];
								for await (let object of listAll(bucket, prefix, true)) {
										promise_array.push(copy(object));
								}
								await Promise.all(promise_array);
								if (destination_exists) {
										return new Response(null, { status: 204 });
								} else {
										return new Response('', { status: 201 });
								}
						}
						case '0': {
								let object = await bucket.get(resource.key);
								if (object === null) {
										return new Response('Not Found', { status: 404 });
								}
								await bucket.put(destination, object.body, {
										httpMetadata: object.httpMetadata,
										customMetadata: object.customMetadata,
								});
								if (destination_exists) {
										return new Response(null, { status: 204 });
								} else {
										return new Response('', { status: 201 });
								}
						}
						default: {
								return new Response('Bad Request', { status: 400 });
						}
				}
		} else {
				let src = await bucket.get(resource.key);
				if (src === null) {
						return new Response('Not Found', { status: 404 });
				}
				await bucket.put(destination, src.body, {
						httpMetadata: src.httpMetadata,
						customMetadata: src.customMetadata,
				});
				if (destination_exists) {
						return new Response(null, { status: 204 });
				} else {
						return new Response('', { status: 201 });
				}
		}
}

async function handle_move(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);
		let overwrite = request.headers.get('Overwrite') === 'T';
		let destination_header = request.headers.get('Destination');
		if (destination_header === null) {
				return new Response('Bad Request', { status: 400 });
		}
		let destination = new URL(destination_header).pathname.slice(1);
		destination = destination.endsWith('/') ? destination.slice(0, -1) : destination;

		// Check if the parent directory exists
		let destination_parent = destination
				.split('/')
				.slice(0, destination.endsWith('/') ? -2 : -1)
				.join('/');
		if (destination_parent !== '' && !(await bucket.head(destination_parent))) {
				return new Response('Conflict', { status: 409 });
		}

		// Check if the destination already exists
		let destination_exists = await bucket.head(destination);
		if (!overwrite && destination_exists) {
				return new Response('Precondition Failed', { status: 412 });
		}

		let resource = await bucket.head(resource_path);
		if (resource === null) {
				return new Response('Not Found', { status: 404 });
		}
		if (resource.key === destination) {
				return new Response('Bad Request', { status: 400 });
		}

		if (destination_exists) {
				// Delete the destination first
				await handle_delete(new Request(new URL(destination_header), request), bucket);
		}

		let is_dir = resource?.customMetadata?.resourcetype === '<collection />';

		if (is_dir) {
				let depth = request.headers.get('Depth') ?? 'infinity';
				switch (depth) {
						case 'infinity': {
								let prefix = resource_path + '/';
								const move = async (object: R2Object) => {
										let target = destination + '/' + object.key.slice(prefix.length);
										target = target.endsWith('/') ? target.slice(0, -1) : target;
										let src = await bucket.get(object.key);
										if (src !== null) {
												await bucket.put(target, src.body, {
														httpMetadata: object.httpMetadata,
														customMetadata: object.customMetadata,
												});
												await bucket.delete(object.key);
										}
								};
								let promise_array = [move(resource)];
								for await (let object of listAll(bucket, prefix, true)) {
										promise_array.push(move(object));
								}
								await Promise.all(promise_array);
								if (destination_exists) {
										return new Response(null, { status: 204 });
								} else {
										return new Response('', { status: 201 });
								}
						}
						case '0': {
								let object = await bucket.get(resource.key);
								if (object === null) {
										return new Response('Not Found', { status: 404 });
								}
								await bucket.put(destination, object.body, {
										httpMetadata: object.httpMetadata,
										customMetadata: object.customMetadata,
								});
								await bucket.delete(resource.key);
								if (destination_exists) {
										return new Response(null, { status: 204 });
								} else {
										return new Response('', { status: 201 });
								}
						}
						default: {
								return new Response('Bad Request', { status: 400 });
						}
				}
		} else {
				let src = await bucket.get(resource.key);
				if (src === null) {
						return new Response('Not Found', { status: 404 });
				}
				await bucket.put(destination, src.body, {
						httpMetadata: src.httpMetadata,
						customMetadata: src.customMetadata,
				});
				await bucket.delete(resource.key);
				if (destination_exists) {
						return new Response(null, { status: 204 });
				} else {
						return new Response('', { status: 201 });
				}
		}
}

function generateUUID() {
		// 创建一个随机的UUID v4
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
				let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
				return v.toString(16);
		});
}

// 生成 Lock-Token
function generateLockToken() {
		const uuid = generateUUID();
		return `opaquelocktoken:${uuid}`;
}

function xmlToJson(xml: string, keepNs = false, ignoreNs: string = undefined): any {
		const obj: any = {};
		xml = xml.trim();

		// 移除 XML 声明
		xml = xml.replace(/<\?xml[^>]*\?>/, '');

		// 正则表达式匹配标签
		let tagRegex
		if(keepNs){
				tagRegex = /<()((?:[^:/>]+):?(?:[^>]*))(?: (?:[^>]*))?>([\s\S]*?)<\/\2>|<((?:(?:[^:/>]+):)?(?:[^/>]+))(\/?)>/g;

				if(!ignoreNs){
						const nsList = listXmlns(xml, false);
						const ignoreItem = nsList.find(item => item.value === 'DAV:')
						if(ignoreItem){
								ignoreNs = ignoreItem.key
						}
				}
		}else{
				tagRegex = /<(?:([^:/>]+):)?([^>]*)(?: (?:[^>]*))?>([\s\S]*?)<\/\1:\2>|<(?:(?:[^:/>]+):)?([^/>]+)(\/?)>/g;
		}
		let match;

		while ((match = tagRegex.exec(xml)) !== null) {
				let tagName = match[2] || match[4]; // 获取标签名
				if(keepNs && ignoreNs && tagName.startsWith(ignoreNs)){
						tagName = tagName.substring(ignoreNs.length + 1)
				}
				const isSelfClosing = match[5] === '/'; // 判断是否为自闭合标签

				if (isSelfClosing) {
						obj[tagName] = null; // 自闭合标签直接赋值为NULL
				} else {
						const tagContent = match[3];

						if (tagContent) {
								if (tagContent.includes('<')) {
										const childObj = xmlToJson(tagContent, keepNs, ignoreNs); // 递归解析子标签
										obj[tagName] = childObj;

										// 如果子标签中只有自闭合标签，提取并赋值
										const childKeys = Object.keys(childObj);
										if (childKeys.length === 1 && childObj[childKeys[0]] === null) {
												obj[tagName] = childKeys[0]; // 将自闭合标签的名称作为值
										}
								} else {
										obj[tagName] = tagContent.trim(); // 处理文本内容
								}
						} else {
								obj[tagName] = null; // 如果没有内容，设置为 null
						}
				}
		}

		return obj;
}

async function handle_lock(request: Request, bucket: R2Bucket, env: Env): Promise<Response> {
		const path = make_resource_path(request);
		const lockedToken = await env.kv.get("lock_" + path);
		if(lockedToken){
				return new Response('', { status: 423 });
		}
		const data = xmlToJson(await request.text())
		if(!data.lockinfo || !data.lockinfo.locktype||!data.lockinfo.lockscope||!data.lockinfo.owner.href){
				console.log("lock failed:", data)
				return new Response('', { status: 428 });
		}
		const token = generateLockToken();
		const ttl = 600;
		const lockXml = `<lockdiscovery>
        <activelock>
            <locktype>
                <${data.lockinfo.locktype}/>
            </locktype>
            <lockscope>
                <${data.lockinfo.lockscope}/>
            </lockscope>
            <locktoken>
                <href>${token}</href>
            </locktoken>
            <lockroot>
                <href>${path}</href>
            </lockroot>
            <depth>infinity</depth>
            <owner>
                <a:href xmlns:a="DAV:">${data.lockinfo.owner.href}</a:href>
            </owner>
            <timeout>Second-${ttl}</timeout>
        </activelock>
    </lockdiscovery>`
		await env.kv.put("lock_" + path, lockXml, {expirationTtl: ttl});
		return new Response(`<?xml version="1.0" encoding="utf-8"?>
<prop xmlns="DAV:">
    ${lockXml}
</prop>`, { status: 201 ,
				headers: { 'Lock-Token': token }
		});
}

async function handle_unlock(request: Request, bucket: R2Bucket, env: Env): Promise<Response> {
		const path = make_resource_path(request);
		await env.kv.delete("lock_" + path);
		return new Response('', { status: 204 });
}

function listXmlns(xml:string, ignoreDav = true): Array<any>{
		xml = xml.trim();

		// 移除 XML 声明
		xml = xml.replace(/<\?xml[^>]*\?>/, '');

		const rootRegex = /<([^ ]+)([^>]*)>/; // 匹配根节点
		const namespaceRegex = /xmlns:([a-zA-Z0-9]+)="([^"]+)"/g;

		const match = rootRegex.exec(xml);
		const namespaces = [];

		if (match) {
				const attributes = match[2];

				let nsMatch;
				while ((nsMatch = namespaceRegex.exec(attributes)) !== null) {
						const key = nsMatch[1];
						const value = nsMatch[2];

						// 只添加非 DAV 的命名空间
						if (!ignoreDav || value !== "DAV:") {
								namespaces.push({ key, value });
						}
				}
		}

		return namespaces;
}

async function handle_proppatch(request: Request, bucket: R2Bucket): Promise<Response> {
		let resource_path = make_resource_path(request);

		const xml = await request.text();
		const nsList = listXmlns(xml);
		const data = xmlToJson(xml, true)
		console.log("data:",data)

		return new Response(`<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:" ${nsList.map(item => `xmlns:${item.key}="${item.value}"`)
				.join(' ')}>
	<response>
        <href>${resource_path}</href>
        <propstat>
            <prop>
				${Object.entries(data.propertyupdate['set'].prop)
								.map(([key, value]) => `<${key} />`)
								.join('\n				')}
            </prop>
            <status>HTTP/1.1 200 OK</status>
        </propstat>
	</response>
</multistatus>`, { status: 207	});
}

const DAV_CLASS = '1';
const SUPPORT_METHODS = ['OPTIONS', 'PROPFIND', 'MKCOL', 'GET', 'HEAD', 'PUT', 'COPY', 'MOVE', 'PROPPATCH', 'DELETE', 'UNLOCK', 'LOCK'];


async function dispatch_handler(request: Request, bucket: R2Bucket, env: Env): Promise<Response> {
		switch (request.method) {
				case 'OPTIONS': {
						return new Response(null, {
								status: 204,
								headers: {
										Allow: SUPPORT_METHODS.join(', '),
										DAV: DAV_CLASS,
								},
						});
				}
				case 'HEAD': {
						return await handle_head(request, bucket);
				}
				case 'GET': {
						return await handle_get(request, bucket);
				}
				case 'PUT': {
						return await handle_put(request, bucket);
				}
				case 'DELETE': {
						return await handle_delete(request, bucket);
				}
				case 'MKCOL': {
						return await handle_mkcol(request, bucket);
				}
				case 'PROPFIND': {
						return await handle_propfind(request, bucket, env);
				}
				case 'COPY': {
						return await handle_copy(request, bucket);
				}
				case 'MOVE': {
						return await handle_move(request, bucket);
				}
				case 'LOCK': {
						return await handle_lock(request, bucket, env);
				}
				case 'UNLOCK': {
						return await handle_unlock(request, bucket, env);
				}
				case 'PROPPATCH': {
						return await handle_proppatch(request, bucket);
				}
				default: {
						return new Response('Method Not Allowed', {
								status: 405,
								headers: {
										Allow: SUPPORT_METHODS.join(', '),
										DAV: DAV_CLASS,
								},
						});
				}
		}
}

export default {
		async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
				const { bucket } = env;

				if (
						request.method !== 'OPTIONS' &&
						request.headers.get('Authorization') !== `Basic ${btoa(`${env.USERNAME}:${env.PASSWORD}`)}`
				) {
						return new Response('Unauthorized', {
								status: 401,
								headers: {
										'WWW-Authenticate': 'Basic realm="webdav"',
								},
						});
				}

				let response: Response = await dispatch_handler(request, bucket, env);

				// Set CORS headers
				response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') ?? '*');
				response.headers.set('Access-Control-Allow-Methods', SUPPORT_METHODS.join(', '));
				response.headers.set(
						'Access-Control-Allow-Headers',
						['authorization', 'content-type', 'depth', 'overwrite', 'destination', 'range'].join(', '),
				);
				response.headers.set(
						'Access-Control-Expose-Headers',
						['content-type', 'content-length', 'dav', 'etag', 'last-modified', 'location', 'date', 'content-range'].join(
								', ',
						),
				);
				response.headers.set('Access-Control-Allow-Credentials', 'false');
				response.headers.set('Access-Control-Max-Age', '86400');

				return response;
		},
};
