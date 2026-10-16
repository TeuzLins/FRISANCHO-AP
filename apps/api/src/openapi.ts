import { reference } from '@frisancho/anthropometry';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = (schema: object) => ({ 'application/json': { schema } });
const response = (description: string, schema: object = ref('Error')) => ({ description, content: content(schema) });
const input = { type: 'object', additionalProperties: false, required: ['ageYears', 'armCircumferenceCm', 'tricepsSkinfoldMm'], properties: {
  ageYears: { type: 'integer', minimum: 0 }, referenceSex: { type: ['string', 'null'], enum: ['female', 'male', null], default: null },
  armCircumferenceCm: { type: 'number', exclusiveMinimum: 0 }, tricepsSkinfoldMm: { type: 'number', exclusiveMinimum: 0 },
  reportedMuscleCircumferenceCm: { type: ['number', 'null'], exclusiveMinimum: 0 }, weightKg: { type: ['number', 'null'], exclusiveMinimum: 0 }, heightCm: { type: ['number', 'null'], exclusiveMinimum: 0 },
  referenceId: { type: 'string', const: 'frisancho-1981', default: 'frisancho-1981' },
}, example: { ageYears: 76, referenceSex: null, armCircumferenceCm: 30, tricepsSkinfoldMm: 16, reportedMuscleCircumferenceCm: 25, referenceId: reference.id } };
const patient = { type: 'object', additionalProperties: false, required: ['identifier', 'displayName'], properties: { identifier: { type: 'string', maxLength: 80 }, displayName: { type: 'string', maxLength: 120 }, birthDate: { type: ['string', 'null'], format: 'date' }, referenceSex: { type: ['string', 'null'], enum: ['male', 'female', null] } } };
const assessment = { type: 'object', additionalProperties: false, required: ['patientId', 'evaluationDate', 'inputs'], properties: { patientId: { type: 'string', format: 'uuid' }, evaluationDate: { type: 'string', format: 'date' }, inputs: ref('CalculationInput'), revision: { type: 'integer', minimum: 1, description: 'Obrigatório no PATCH.' } } };
const paths: Record<string, Record<string, unknown>> = {};
function add(route: string, method: string, summary: string, auth = false, body?: object, success: object = { type: 'object' }, status = '200') {
  const mutation = ['post', 'patch', 'delete'].includes(method); const parameters: object[] = [];
  if (route.includes('{id}')) parameters.push({ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
  if (auth && mutation) parameters.push({ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } });
  if (mutation && route !== '/calculations/cmb') parameters.push({ name: 'Origin', in: 'header', required: true, schema: { type: 'string', format: 'uri' }, description: 'Exatamente APP_ORIGIN.' });
  if ((route === '/assessments' && method === 'post') || (route === '/assessments/{id}' && method === 'patch')) parameters.push({ name: 'Idempotency-Key', in: 'header', required: method === 'post', schema: { type: 'string', format: 'uuid' }, description: 'Reutilize no retry de payload idêntico; validade de sete dias. Resposta original preservada após edição. Exclusão retorna 410 até expirar.' });
  if (['/patients', '/assessments'].includes(route) && method === 'get') {
    parameters.push(...['page', 'limit'].map(name => ({ name, in: 'query', schema: { type: 'integer', minimum: 1, maximum: name === 'limit' ? 100 : 100000, default: name === 'limit' ? 20 : 1 } })));
    if (route === '/patients') parameters.push({ name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 } }, { name: 'archived', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'all'], default: 'active' } });
    else parameters.push({ name: 'patientId', in: 'query', schema: { type: 'string', format: 'uuid' } }, ...['from', 'to'].map(name => ({ name, in: 'query', schema: { type: 'string', format: 'date' } })), { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } });
  }
  if (route.startsWith('/patients') && ['post', 'patch'].includes(method)) success = ref('Patient');
  if (route.startsWith('/assessments') && ['post', 'patch'].includes(method)) success = ref('Assessment');
  paths[route] ||= {};
  paths[route][method] = { summary, security: auth ? [{ sessionCookie: [] }] : [], parameters,
    ...(body ? { requestBody: { required: true, content: content(body) } } : {}),
    responses: { [status]: status === '204' ? { description: 'Concluído, sem corpo.' } : response('Sucesso', success), '401': response('Não autenticado'), '403': response('Origem ou CSRF rejeitado'), '404': response('Registro não encontrado'), '409': response('Conflito de registro/revisão/idempotência'), '410': response('Registro da tentativa excluído'), '422': response('Falha de validação'), '429': response('Limite de requisições'), '503': response('Serviço indisponível') },
  };
}
add('/live', 'get', 'Saúde do processo, independente do banco');
add('/ready', 'get', 'Prontidão PostgreSQL com prazo máximo de cinco segundos');
add('/health', 'get', 'Compatibilidade: mesma prontidão de /ready'); add('/references', 'get', 'Metadados versionados');
add('/calculations/cmb', 'post', 'Calcula CMB sem persistência e sem identificação pessoal', false, ref('CalculationInput'), ref('CalculationResult'));
const credentials = { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 12, maxLength: 128 } } };
add('/auth/login', 'post', 'Login com sessão revogável e csrfToken', false, credentials);
add('/auth/register', 'post', 'Cadastro e início de sessão', false, { ...credentials, required: ['email', 'password', 'name'], properties: { ...credentials.properties, name: { type: 'string', minLength: 2, maxLength: 100 } } }, { type: 'object' }, '201');
add('/auth/me', 'get', 'Usuário atual e token CSRF', true); add('/auth/logout', 'post', 'Revoga sessão', true, undefined, {}, '204');
for (const [resource, schema] of [['patients', patient], ['assessments', assessment]] as const) {
  add(`/${resource}`, 'get', `Lista ${resource} com paginação e filtros`, true, undefined, { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } });
  add(`/${resource}`, 'post', `Cria ${resource}`, true, schema, { type: 'object' }, '201');
  add(`/${resource}/{id}`, 'get', 'Obtém registro privado', true);
  add(`/${resource}/{id}`, 'patch', 'Atualiza; avaliações são recalculadas e auditadas', true, resource === 'assessments' ? { ...schema, required: [...schema.required, 'revision'] } : { ...schema, required: [], properties: { ...schema.properties, archived: { type: 'boolean', description: 'Arquivar preserva avaliações e relatórios.' } } });
  add(`/${resource}/{id}`, 'delete', 'Exclui registro; pacientes com avaliações retornam 409', true, undefined, {}, '204');
}
add('/assessments/{id}/report', 'get', 'Relatório A4 baseado no snapshot salvo', true);
(paths['/assessments/{id}/report'].get as { responses: Record<string, unknown> }).responses['200'] = { description: 'PDF A4', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } };
add('/assessments/{id}/audit', 'get', 'Revisões da avaliação', true); add('/account/export', 'get', 'Exporta dados em JSON', true);
add('/account', 'delete', 'Exclui conta e todos os dados vinculados', true, { type: 'object', required: ['password', 'confirmation'], properties: { password: { type: 'string' }, confirmation: { const: 'EXCLUIR' } } }, {}, '204');
export const openapi = {
  openapi: '3.1.0', info: { title: 'FRISANCHO AP API', version: '1.0.0', description: 'Servidor recalcula ao salvar. Snapshots preservam histórico. CMB deve ser positiva; sem percentis nem diagnóstico automático. Cookies HttpOnly; Secure em produção. Respostas privadas no-store.' }, servers: [{ url: '/api/v1' }], paths,
  components: { securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'frisancho', description: 'Em produção: __Host-frisancho.' } }, schemas: {
    Patient: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, ...patient.properties, archivedAt: { type: ['string', 'null'], format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, _count: { type: 'object', properties: { assessments: { type: 'integer' } } } } },
    Assessment: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, patientId: { type: 'string', format: 'uuid' }, patient: { type: 'object', description: 'Snapshot histórico de id, nome, identificador, nascimento e sexo; não depende do cadastro atual.' }, evaluationDate: { type: 'string', format: 'date' }, ageYears: { type: 'integer' }, inputs: ref('CalculationInput'), result: ref('CalculationResult'), referenceId: { type: 'string' }, engineVersion: { type: 'string' }, revision: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
    CalculationInput: input,
    CalculationResult: { type: 'object', properties: { input: ref('CalculationInput'), muscleCircumferenceCm: { type: 'number', example: 24.97345175425633 }, tricepsSkinfoldCm: { type: 'number', example: 1.6 }, displayValue: { type: 'string', example: '24,97' }, unit: { const: 'cm' }, engineVersion: { type: 'string' }, rounding: { type: 'string' }, reference: { type: 'object' }, percentile: { type: 'null' }, classification: { type: 'null' }, bmi: { type: ['number', 'null'] }, warnings: { type: 'array', items: ref('Reason') }, classificationUnavailableReasons: { type: 'array', items: ref('Reason') } } },
    Reason: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
    Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, fields: { type: 'object' }, issues: { type: 'array', items: { type: 'object' } } } } }, examples: [{ error: { code: 'VALIDATION_ERROR', message: 'Confira os campos indicados.', fields: { armCircumferenceCm: ['Informe uma CB positiva.'] } } }, { error: { code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.', fields: {} } }] },
  } },
};
