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
            validate: (input, answers) => {
                console.log('input: ' + input);
                // console.log(answers);
                const result = Joi.validate({name: input}, Joi.string().min(10).max(50));
                return result.error;

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