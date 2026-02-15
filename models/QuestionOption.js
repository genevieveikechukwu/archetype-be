const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const QuestionOption = sequelize.define(
    "QuestionOption",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      question_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "test_questions", key: "id" },
      },
      option_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      is_correct: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      order_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "question_options",
      timestamps: false,
    },
  );

  return QuestionOption;
};
