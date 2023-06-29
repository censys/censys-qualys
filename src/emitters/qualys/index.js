// index.js

const {http} = _g.components;
const FormData = _g.require['form-data'];

module.exports = class {

	constructor({
		qualys_username = '',
		qualys_password = '',
		catchErrors = true,
		qualys_api_url = ''
	})
	{
		const httpRequest = catchErrors ? http.tryRequest : http.request;

		let defaultHeaders = {
						'cache-control': 'no-cache',
						'user-agent': 'censys-qualys/1.0',
						'X-Requested-With': 'censys-qualys/1.0',
						'authorization': '',
					};

		// compute Authorization header from username and password
		const buf = Buffer.from(`${qualys_username}:${qualys_password}`, 'ascii');
		defaultHeaders.authorization = `Basic ${buf.toString('base64')}`;

		this.addIps = (ips = []) => {
			// we need to first remove the IPs from the exclusion list in the event they are on there; this happens when a host is associated -> disassociated -> re-associated; if we don't remove the
			// IPs from the exclusion list, they won't get scanned as expected
			const removeExcludesForm = new FormData();
 			removeExcludesForm.append('action', 'remove');
 			removeExcludesForm.append('comment', 'censys_asm');
 			removeExcludesForm.append('ips', ips.join());
			
			const removeExcludesPayload = removeExcludesForm.getBuffer().toString();
			const removeExcludesBoundary = removeExcludesForm.getBoundary();
			defaultHeaders['content-type'] = `multipart/form-data; boundary=${removeExcludesBoundary}`;

			const removeExcludesReq = httpRequest(`${qualys_api_url}/api/2.0/fo/asset/excluded_ip/`, {
				method: 'POST',
				headers: {...defaultHeaders},
				payload: removeExcludesPayload
			});
			// ignore failures - it technically fails if the IPs weren't in the exclusion list to begin with so consider that a success
			// if (!removeExcludesReq.success) {
			// 	return removeExcludesReq;
			// }

			const form = new FormData();
 			form.append('action', 'add');
 			form.append('enable_vm', '1');
 			form.append('ips', ips.join());
			
			const payload = form.getBuffer().toString();
			const boundary = form.getBoundary();
			defaultHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;

			return httpRequest(`${qualys_api_url}/api/2.0/fo/asset/ip/`, {
				method: 'POST',
				headers: {...defaultHeaders},
				payload: payload
			});
		}

		this.excludeIps = (ips = [], comment = 'censys_asm') => {
			const form = new FormData();
 			form.append('action', 'add');
 			form.append('comment', comment);
 			form.append('ips', ips.join());
			
			const payload = form.getBuffer().toString();
			const boundary = form.getBoundary();
			defaultHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;

			return httpRequest(`${qualys_api_url}/api/2.0/fo/asset/excluded_ip/`, {
				method: 'POST',
				headers: {...defaultHeaders},
				payload: payload
			});
		}

		this.listIps = () => {
			const form = new FormData();
 			form.append('action', 'list');
			
			const payload = form.getBuffer().toString();
			const boundary = form.getBoundary();
			defaultHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;

			return httpRequest(`${qualys_api_url}/api/2.0/fo/asset/ip/`, {
				method: 'POST',
				headers: {...defaultHeaders},
				payload: payload
			});

		}
	}
}

