const API_JIRA_URL = `https://fktech.atlassian.net/rest/api/2/`;

const FRONT_URL = process.env.FRONT_URL || 'http://localhost:5500';
const PORT = process.env.PORT || '3010';

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(bodyParser.json());
app.use(cors({ 
    origin: `${FRONT_URL}` 
}));

app.get('/', (req, res) => res.send('app corriendo...'));
app.get('/worklog/:from/:to', getWorklogs);
app.post('/worklog', addWorklog);
app.put('/worklog', updateWorklog);
app.delete('/worklog', deleteWorklog);

app.listen(PORT);

function getWorklogs(req, res) {
    const { from: startDate, to: endDate } = req.params;
    const { token, email } = req.headers;

    const consulta = `search?jql=worklogAuthor='${email}' AND worklogDate>='${startDate}' AND worklogDate<='${endDate}'`;
    const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(
            email + ':' + token
        ).toString('base64')}`
    };

    axios.get(`${API_JIRA_URL}${consulta}`, { headers })
        .then(response => {
            const jsonData = response.data;
            mapIssuesToWorklog(jsonData, req, res);
        })
        .catch(error => {
            console.error(error);
        });
}

function mapIssuesToWorklog(data, req, res) {
    const startDate = new Date(`${req.params.from}`);
    const endDate = new Date(`${req.params.to} 23:59:59`);
    const { token, email } = req.headers;

    const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(
            email + ':' + token
        ).toString('base64')}`
    };
    const descriptions = data.issues.map(issue => ({
        key: issue.key,
        title: issue.fields.summary,
        description: issue.fields.description,
        parentKey: issue.fields.parent?.key,
        parentTitle: issue.fields.parent?.fields.summary
    }));

    const urls = data.issues.map(issue => encodeURI(`${API_JIRA_URL}issue/${issue.key}/worklog`));
    const requests = urls.map(url => axios.get(url, { headers }));

    Promise.all(requests)
        .then(responses => {
            // aquí puedes trabajar con las respuestas de cada solicitud
            const responsesResult = responses = responses.map((issue, index) => 
                issue.data.worklogs.map(wl => ({
                    ...wl,
                    description: descriptions[index]
                }))
            )
            .flat();

            const worklogsRaw = responsesResult
                .map(({ comment, started, timeSpent, timeSpentSeconds, author, description, id }) => ({ comment, started, timeSpent, timeSpentSeconds, author, description, id }))
                .filter(({ started }) => {
                    const startedDate = new Date(started);
                    return startedDate >= startDate && startedDate <= endDate;
                })
                .reduce((acumulador, registro) => {
                    const fecha = registro.started.substr(0, 10); // obtener la fecha del campo "started"
                    if (!acumulador[fecha]) {
                        acumulador[fecha] = []; // si no existe una entrada para la fecha, crearla
                    }
                    acumulador[fecha].push(registro); // agregar el registro a la entrada correspondiente
                    return acumulador;
                }, {});
            
            const authors = responsesResult
                .map(({ author: { emailAddress, displayName } }) => ({ emailAddress, displayName }))
                .filter((item, index, arr) => arr.findIndex(subitem => subitem.displayName === item.displayName) === index);

            let worklogs = {};
            // Iterar a través de cada fecha y comentario en el objeto de entrada
            for (const [date, comments] of Object.entries(worklogsRaw)) {
                worklogs[date] = {};
                for (const comment of comments) {
                    const authorEmail = comment.author.emailAddress;
                    // Crear entrada para el autor si no existe
                    if (!worklogs[date][authorEmail]) {
                        worklogs[date][authorEmail] = [];
                    }
                    // Agregar comentario a la entrada del autor correspondiente
                    worklogs[date][authorEmail].push({
                        comment: comment.comment,
                        started: comment.started,
                        timeSpent: comment.timeSpent,
                        timeSpentSeconds: comment.timeSpentSeconds,
                        description: comment.description,
                        id: comment.id
                    });
                }
            }

            worklogs = Object.fromEntries(
                Object.entries(worklogs).sort()
            );

            for (const date in worklogs) {
                for (const user in worklogs[date]) {
                    const totalTimeSpentSeconds = worklogs[date][user].reduce((accumulator, currentValue) => 
                        accumulator + currentValue.timeSpentSeconds
                    , 0);
                    
                    const hours = Math.floor(totalTimeSpentSeconds / 3600);
                    const minutes = Math.floor((totalTimeSpentSeconds % 3600) / 60);
                    
                    const totalTimeSpentFormatted = `${hours}h${Boolean(minutes) ? ' ' + minutes + 'm' : ''}`;

                    worklogs[date][user].push({
                        totalTimeSpentSeconds,
                        totalTimeSpentFormatted
                    });
                }
            }

            const result = {
                authors,
                worklogs
            };

            res.json(result);
        })
        .catch(error => {
            console.error(error);
        });
}

function addWorklog(req, res) {
    const { comment, started, timeSpentSeconds, key } = req.body;
    const { token, email } = req.headers;

    const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(
            email + ':' + token
        ).toString('base64')}`
    };
    const consuta = `issue/CG-${key}/worklog?notifyUsers=false`;
    const body = {comment, started, timeSpentSeconds};

    axios.post(`${API_JIRA_URL}${consuta}`, body, { headers })
        .then(response => {
            res.json(response.data);
        })
        .catch(error => {
            console.error(error);
            res.json({error});
        });
}

function updateWorklog(req, res) {
    const { comment, started, timeSpentSeconds, key, id } = req.body;
    const consuta = `issue/CG-${key}/worklog/${id}?notifyUsers=false`;
    const body = {comment, started, timeSpentSeconds};
    const { token, email } = req.headers;

    const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(
            email + ':' + token
        ).toString('base64')}`
    };

    axios.put(`${API_JIRA_URL}${consuta}`, body, { headers })
        .then(response => {
            res.json(response.data);
        })
        .catch(error => {
            console.error(error);
            res.json({error});
        });
}

function deleteWorklog(req, res) {
    const { key, id } = req.body;
    const consuta = `issue/CG-${key}/worklog/${id}?notifyUsers=false`;
    const { token, email } = req.headers;

    const headers = {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(
            email + ':' + token
        ).toString('base64')}`
    };

    axios.delete(`${API_JIRA_URL}${consuta}`, { headers })
        .then(response => {
            res.json(response.data);
        })
        .catch(error => {
            console.error(error);
            res.json({error});
        });
}
