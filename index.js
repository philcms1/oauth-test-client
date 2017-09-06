const program = require('commander');
const inquirer = require('inquirer');
const Joi = require('joi');

program
    .version('0.0.1')
    .option('-c, --clients', 'Load JSON file containing clients information')
    .parse(process.argv);

const clientNameSchema = {

};

let clientMethodPrompt = {
    type: 'list',
    name: 'clientMethod',
    message: 'How do you want to load the client?',
    choices: [
        'Dynamic client registration',
        'Enter client information'
    ]
};

let dcr = () => {
    inquirer.prompt([
        {
            type: 'input',
            name: 'client.name',
            message: 'Human-readable display name for the client',
            validate: (input) => {
                console.log('input: ' + input);
                const result = Joi.validate(input, Joi.string().min(10).max(50));
                return result.error ? 'Client name must be between 10 and 50 characters' : true;
            }
        }
    ]).then(answers => {
        console.log(answers);
    })
};

inquirer.prompt(clientMethodPrompt).then(function (answers) {
    // console.log(JSON.stringify(answers, null, '  '));
    let {clientMethod} = answers;
    if (clientMethod === 'Dynamic client registration') {
        dcr();
    }
});